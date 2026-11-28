#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Picket Code — summarize every JUnit XML under a directory into one Markdown table.
 *
 *  Reads `test-results/*.xml` (L1/L2 from build/test/run-unit-junit.mjs, L4 from the
 *  smoke runner's mocha-junit-reporter, L5 from the existing verify scripts), prints
 *
 *    | 层 | 套件 | 用例 | 通过 | 失败 | 跳过 | 耗时 |
 *
 *  lists the failing test names, writes the same Markdown to `<dir>/summary.md` and
 *  appends it to $GITHUB_STEP_SUMMARY when that variable is set.
 *
 *  Zero dependencies on purpose: this runs in the release job (no npm ci there) and on
 *  a developer machine. The XML is parsed with regexes, tolerating missing attributes.
 *
 *  Usage: node build/test/summarize.mjs [--dir test-results]   (relative to the repo root)
 *
 *  Exits 1 when a test failed or when no report was found at all — a missing report must
 *  never read as "all green".
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = 'test-results';
const MAX_LISTED_FAILURES = 100;
// build/test/summarize.mjs → the repository root, so `--dir test-results` means the same
// directory no matter which job (or shell) invokes it.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const USAGE = `Usage: node build/test/summarize.mjs [options]

  --dir <dir>   directory holding the JUnit XML files, relative to the repository root,
                default "${DEFAULT_DIR}"
  -h, --help    print this help`;

/** Layer a report file belongs to, from its name / the testsuites name. */
const LAYER_RULES = [
	{ layer: 'L2', pattern: /(acp[-_ ]?process|\bl2\b)/i },
	// The L3 job reports as `host-e2e`, the suite as `iCode agent host … (L3)`.
	{ layer: 'L3', pattern: /(host[-_ ]?e2e|agent[-_ ]?host.*(e2e|integration)|\be2e\b|\bl3\b)/i },
	{ layer: 'L4', pattern: /(smoke|agents[-_ ]?window|[:/]ui\b|\bl4\b)/i },
	{ layer: 'L5', pattern: /(verify[-_ ]?release|\bverify\b|\bl5\b)/i },
	{ layer: 'L1', pattern: /(icode|changeset|chat|unit|\bl1\b)/i },
];

function die(message) {
	console.error(`[summarize] ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { dir: DEFAULT_DIR };

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
			case '--dir': options.dir = value(); break;
			case '-h':
			case '--help':
				console.log(USAGE);
				process.exit(0);
				break;
			default: die(`unknown argument "${flag}"\n\n${USAGE}`);
		}
	}
	return options;
}

/** Minimal XML entity decoding for attribute values. */
function decodeXml(value) {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** Attribute map of a tag's attribute blob, tolerant of missing quotes/attributes. */
function attributes(blob) {
	const result = {};
	if (!blob) {
		return result;
	}
	for (const match of blob.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
		result[match[1]] = decodeXml(match[2]);
	}
	return result;
}

function toNumber(value) {
	const parsed = Number.parseFloat(value ?? '');
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @returns {{ name: string, file: string, layer: string, tests: number, passed: number,
 *            failed: number, skipped: number, seconds: number,
 *            failures: { name: string, message: string }[] }}
 */
function parseReport(file, text) {
	const testsuitesTag = /<testsuites\b([^>]*)>/.exec(text);
	const suitesAttributes = attributes(testsuitesTag?.[1]);
	const name = suitesAttributes.name || file.replace(/\.xml$/i, '').replace(/-results$/i, '');

	let tests = 0;
	let passed = 0;
	let failed = 0;
	let skipped = 0;
	let seconds = 0;
	const failures = [];

	for (const match of text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
		const testAttributes = attributes(match[1]);
		const body = match[3] ?? '';

		tests++;
		seconds += toNumber(testAttributes.time);

		if (/<failure\b|<error\b/.test(body)) {
			failed++;
			const failureTag = /<(?:failure|error)\b([^>]*)>/.exec(body);
			const message = attributes(failureTag?.[1]).message
				?? body.replace(/<[^>]*>/g, '').replace(/^\s+/, '').split('\n')[0];
			failures.push({
				name: testAttributes.name ?? testAttributes.classname ?? '(unnamed test)',
				message: message.trim(),
			});
		} else if (/<skipped\b|<pending\b/.test(body)) {
			skipped++;
		} else {
			passed++;
		}
	}

	if (!tests) {
		// A suite-level report (no <testcase> children) still carries counts and time.
		tests = toNumber(suitesAttributes.tests);
		passed = Math.max(0, tests - toNumber(suitesAttributes.failures) - toNumber(suitesAttributes.skipped));
		failed = toNumber(suitesAttributes.failures);
		skipped = toNumber(suitesAttributes.skipped);
		seconds = toNumber(suitesAttributes.time);
	}

	const layer = layerOf(`${file} ${name}`);
	return { name, file, layer, tests, passed, failed, skipped, seconds, failures };
}

function layerOf(haystack) {
	for (const rule of LAYER_RULES) {
		if (rule.pattern.test(haystack)) {
			return rule.layer;
		}
	}
	return '—';
}

function formatDuration(seconds) {
	if (!seconds) {
		return '0s';
	}
	// Round once, up front: rounding the remainder afterwards can print "1m 60s".
	const total = Math.round(seconds);
	if (total < 60) {
		return total < 10 && seconds < 10 ? `${seconds.toFixed(1)}s` : `${total}s`;
	}
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function escapeCell(value) {
	return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const dir = isAbsolute(options.dir) ? options.dir : resolve(REPO_ROOT, options.dir);

	if (!existsSync(dir)) {
		die(`no report directory at ${dir} — nothing ran, so nothing can be summarized`);
	}

	const files = readdirSync(dir)
		.filter(entry => entry.toLowerCase().endsWith('.xml'))
		.sort();

	if (!files.length) {
		die(`no JUnit XML under ${dir} — nothing ran, so nothing can be summarized`);
	}

	const reports = files.map(file => parseReport(file, readFileSync(join(dir, file), 'utf8')));

	const totals = reports.reduce((sum, report) => ({
		tests: sum.tests + report.tests,
		passed: sum.passed + report.passed,
		failed: sum.failed + report.failed,
		skipped: sum.skipped + report.skipped,
		seconds: sum.seconds + report.seconds,
	}), { tests: 0, passed: 0, failed: 0, skipped: 0, seconds: 0 });

	const lines = [];
	lines.push('## 测试报告 (JUnit)');
	lines.push('');
	lines.push('| 层 | 套件 | 用例 | 通过 | 失败 | 跳过 | 耗时 |');
	lines.push('|---|---|---|---|---|---|---|');
	for (const report of reports) {
		const suite = report.failed > 0 ? `${report.name} ❌` : report.name;
		lines.push(`| ${report.layer} | ${escapeCell(suite)} | ${report.tests} | ${report.passed} | ${report.failed} | ${report.skipped} | ${formatDuration(report.seconds)} |`);
	}
	lines.push(`| **合计** | ${reports.length} 份报告 | ${totals.tests} | ${totals.passed} | ${totals.failed} | ${totals.skipped} | ${formatDuration(totals.seconds)} |`);

	const missingLayers = ['L1', 'L2', 'L3', 'L4', 'L5'].filter(layer => !reports.some(report => report.layer === layer));
	if (missingLayers.length) {
		lines.push('');
		lines.push(`> 本次未产出报告的层：${missingLayers.join('、')}（未运行或报告缺失）。`);
	}

	const allFailures = reports.flatMap(report => report.failures.map(failure => ({ layer: report.layer, suite: report.name, ...failure })));
	if (allFailures.length) {
		lines.push('');
		lines.push(`### 失败用例（${allFailures.length}）`);
		lines.push('');
		for (const failure of allFailures.slice(0, MAX_LISTED_FAILURES)) {
			const message = failure.message ? ` — ${escapeCell(failure.message)}` : '';
			lines.push(`- [${failure.layer}] ${escapeCell(failure.suite)} › ${escapeCell(failure.name)}${message}`);
		}
		if (allFailures.length > MAX_LISTED_FAILURES) {
			lines.push(`- …还有 ${allFailures.length - MAX_LISTED_FAILURES} 个失败用例，见 XML 附件。`);
		}
	}

	const markdown = `${lines.join('\n')}\n`;

	console.log(markdown);

	writeFileSync(join(dir, 'summary.md'), markdown);

	const stepSummary = process.env.GITHUB_STEP_SUMMARY;
	if (stepSummary) {
		appendFileSync(stepSummary, `\n${markdown}`);
		console.log(`[summarize] appended the table to $GITHUB_STEP_SUMMARY`);
	}

	console.log(`[summarize] ${reports.length} report(s): ${totals.tests} tests, ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`);
	if (!totals.tests) {
		die(`the reports under ${dir} contain no test cases — treat this as a failure`);
	}
	if (totals.failed) {
		process.exit(1);
	}
}

main();
