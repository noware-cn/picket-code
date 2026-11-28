#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Picket Code — run compiled node tests under mocha and write JUnit XML.
 *
 *  Why this exists: `npm run test-node` (vscode/test/unit/node/index.js) builds its own
 *  Mocha instance and never exposes the reporter pipeline, so it cannot emit JUnit.
 *  Instead of patching that file (patch 65 in docs/testing.md §6) this wrapper drives
 *  mocha directly over a glob of already-compiled files and repeats the global setup
 *  test-node performs (`_VSCODE_PRODUCT_JSON`, `_VSCODE_FILE_ROOT`, the test-infra file
 *  helpers), so the same test files run unchanged.
 *
 *  Usage (from the repository root, `vscode/` prepared by build/test/prepare-vscode.sh):
 *
 *    node build/test/run-unit-junit.mjs --name icode \
 *      [--glob 'out/vs/platform/agentHost/test/node/icode/*.test.js'] \
 *      [--glob …] [--exclude '**\/icodeAcpProcess.test.js'] \
 *      [--dir test-results] [--timeout 30000] [--vscode vscode]
 *
 *  --glob     repeatable; relative globs resolve inside the VS Code tree, defaults to
 *             out/vs/platform/agentHost/test/node/icode/*.test.js
 *  --exclude  repeatable minimatch pattern, matched against the path inside the tree
 *  --name     report name, used for test-results/<name>-<os>-results.xml
 *  --dir      report directory, relative to the repository root (default test-results)
 *  --timeout  per-test timeout in ms (default 30000)
 *  --vscode   VS Code tree to test (default <repo>/vscode)
 *
 *  Exits non-zero when a test fails, when nothing matches the glob, or when the JUnit
 *  file could not be written — a missing report must never look like a pass.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_GLOB = 'out/vs/platform/agentHost/test/node/icode/*.test.js';
const DEFAULT_TIMEOUT_MS = 30000;

const USAGE = `Usage: node build/test/run-unit-junit.mjs [options]

  --glob <pattern>     repeatable; defaults to ${DEFAULT_GLOB}
  --exclude <pattern>  repeatable minimatch pattern, relative to the VS Code tree
  --name <name>        report name (test-results/<name>-<os>-results.xml), default "unit"
  --dir <dir>          report directory, relative to the repository root, default "test-results"
  --timeout <ms>       per-test timeout, default ${DEFAULT_TIMEOUT_MS}
  --vscode <dir>       VS Code tree to test, default <repo>/vscode
  -h, --help           print this help`;

function die(message) {
	console.error(`\n[run-unit-junit] ${message}\n`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = {
		globs: [],
		excludes: [],
		name: 'unit',
		dir: 'test-results',
		timeout: DEFAULT_TIMEOUT_MS,
		vscode: null,
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = () => {
			const next = argv[++i];
			if (next === undefined) {
				die(`${flag} needs a value\n\n${USAGE}`);
			}
			return next;
		};

		switch (flag) {
			case '--glob': options.globs.push(value()); break;
			case '--exclude': options.excludes.push(value()); break;
			case '--name': options.name = value(); break;
			case '--dir': options.dir = value(); break;
			case '--vscode': options.vscode = value(); break;
			case '--timeout': {
				const parsed = Number(value());
				if (!Number.isFinite(parsed) || parsed <= 0) {
					die(`--timeout needs a positive number of milliseconds`);
				}
				options.timeout = parsed;
				break;
			}
			case '-h':
			case '--help':
				console.log(USAGE);
				process.exit(0);
				break;
			default:
				die(`unknown argument "${flag}"\n\n${USAGE}`);
		}
	}

	if (!options.globs.length) {
		options.globs.push(DEFAULT_GLOB);
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));

const invocationDir = process.cwd();
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const vscodeDir = resolve(invocationDir, options.vscode ?? join(repoRoot, 'vscode'));
// The report directory is a repository-level convention shared by every layer (the
// smoke runner writes to $GITHUB_WORKSPACE/test-results too), so a relative --dir is
// resolved against the repository root, not the shell's cwd.
const reportDir = isAbsolute(options.dir) ? options.dir : resolve(repoRoot, options.dir);
const reportFile = join(reportDir, `${options.name}-${process.platform}-results.xml`);

if (!existsSync(join(vscodeDir, 'package.json'))) {
	die(`no VS Code tree at ${vscodeDir}\n`
		+ `  prepare it first: bash build/test/prepare-vscode.sh <vscode-tag>`);
}

const vscodeRequire = createRequire(join(vscodeDir, 'package.json'));

function loadFromTree(id) {
	try {
		return vscodeRequire(id);
	} catch (err) {
		if (err && err.code === 'MODULE_NOT_FOUND') {
			die(`"${id}" is not installed in ${vscodeDir}/node_modules\n`
				+ `  run "cd vscode && npm ci" (or restore the CI cache) first`);
		}
		throw err;
	}
}

function canLoadFromTree(id) {
	try {
		vscodeRequire.resolve(id);
		return true;
	} catch {
		return false;
	}
}

process.env.MOCHA_COLORS = '1'; // must be set before mocha is loaded

const Mocha = loadFromTree('mocha');
const globModule = loadFromTree('glob');
const minimatch = loadFromTree('minimatch');

// `glob` is pinned to different majors across upstream bumps: 5.x exposes `sync`,
// 9.x+ exposes `globSync`.
const globSync = typeof globModule.globSync === 'function' ? globModule.globSync : globModule.sync;

const files = [];
for (const pattern of options.globs) {
	const absolutePattern = isAbsolute(pattern) ? pattern : join(vscodeDir, pattern);
	const found = globSync(absolutePattern, { nodir: true }) ?? [];
	if (!found.length) {
		console.warn(`[run-unit-junit] warning: ${pattern} matched nothing`);
	}
	for (const file of found) {
		const insideTree = relative(vscodeDir, file).split(sep).join('/');
		if (options.excludes.some(exclude => minimatch(insideTree, exclude))) {
			continue;
		}
		if (!files.includes(file)) {
			files.push(file);
		}
	}
}
files.sort();

if (!files.length) {
	die(`no test file matched:\n  ${options.globs.join('\n  ')}\n`
		+ `  (searched ${vscodeDir}${options.excludes.length ? `, excluding ${options.excludes.join(', ')}` : ''})`);
}

console.log(`[run-unit-junit] ${options.name}: ${files.length} file(s) from ${vscodeDir}`);
for (const file of files) {
	console.log(`[run-unit-junit]   ${relative(vscodeDir, file).split(sep).join('/')}`);
}

// --- global setup, mirroring vscode/test/unit/node/index.js -------------------------------

globalThis._VSCODE_PRODUCT_JSON = JSON.parse(await readFile(join(vscodeDir, 'product.json'), 'utf8'));
globalThis._VSCODE_PACKAGE_JSON = JSON.parse(await readFile(join(vscodeDir, 'package.json'), 'utf8'));
globalThis._VSCODE_FILE_ROOT = pathToFileURL(join(vscodeDir, 'out')).href;

// Snapshot tests and friends read/write through these helpers.
Object.assign(globalThis, {
	__readFileInTests: path => readFile(path, 'utf-8'),
	__writeFileInTests: (path, contents) => writeFile(path, contents),
	__readDirInTests: path => readdir(path),
	__unlinkInTests: path => unlink(path),
	__mkdirPInTests: dir => mkdir(dir, { recursive: true }),
});

process.on('uncaughtException', err => {
	console.error(err?.stack ?? err);
});
process.on('unhandledRejection', reason => {
	console.error('Unhandled promise rejection:');
	console.error(reason?.stack ?? reason);
});

// Tests assume they run from the VS Code tree, like `npm run test-node` does.
process.chdir(vscodeDir);

// --- mocha + reporter ---------------------------------------------------------------------
mkdirSync(reportDir, { recursive: true });

const junitOptions = {
	mochaFile: reportFile,
	testsuitesTitle: options.name,
	useFullSuiteTitle: true,
	suiteTitleSeparatedBy: ' › ',
	includePending: true,
	outputs: false, // the spec reporter prints to stdout; junit only writes the file
};

// The junit reporter alone prints nothing, which makes a CI log useless; pair it with
// `spec` through mocha-multi-reporters when that devDependency is installed.
const useMultiReporter = canLoadFromTree('mocha-multi-reporters');
const reporter = useMultiReporter ? 'mocha-multi-reporters' : 'mocha-junit-reporter';
const reporterOptions = useMultiReporter
	? { reporterEnabled: 'spec, mocha-junit-reporter', mochaJunitReporterReporterOptions: junitOptions }
	: junitOptions;

const mocha = new Mocha({
	ui: 'tdd',
	timeout: options.timeout,
	reporter,
	reporterOptions,
});

const started = Date.now();
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

async function loadTestFiles() {
	for (const file of files) {
		// `pre-require` is what installs the tdd globals (`suite`, `test`, …) for the file.
		mocha.suite.emit(Mocha.Suite.constants.EVENT_FILE_PRE_REQUIRE, globalThis, file, mocha);
		const module = await import(pathToFileURL(file).href);
		mocha.suite.emit(Mocha.Suite.constants.EVENT_FILE_REQUIRE, module, file, mocha);
		mocha.suite.emit(Mocha.Suite.constants.EVENT_FILE_POST_REQUIRE, globalThis, file, mocha);
	}
}

try {
	await loadTestFiles();
} catch (err) {
	die(`failed to load the test files:\n${err?.stack ?? err}`);
}

const runner = mocha.run(failureCount => {
	const seconds = (Date.now() - started) / 1000;
	const reportWritten = existsSync(reportFile);

	console.log(`\n[run-unit-junit] ${options.name}: ${passed} passed, ${failed} failed, ${skipped} skipped, ${seconds.toFixed(1)}s`);
	if (reportWritten) {
		console.log(`[run-unit-junit] report: ${reportFile}`);
	} else {
		console.error(`[run-unit-junit] FAILED to write ${reportFile} — the JUnit reporter did not run`);
	}
	for (const failure of failures) {
		console.log(`[run-unit-junit] FAIL ${failure.title}${failure.message ? ` — ${failure.message}` : ''}`);
	}

	process.exit(failureCount || !reportWritten ? 1 : 0);
});

runner.on('pass', () => {
	passed++;
});
runner.on('fail', (test, err) => {
	failed++;
	failures.push({
		title: typeof test?.fullTitle === 'function' ? test.fullTitle() : String(test?.title ?? test),
		message: (err?.message ?? '').split('\n')[0],
	});
});
runner.on('pending', () => {
	skipped++;
});
