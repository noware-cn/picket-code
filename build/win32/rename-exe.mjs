#!/usr/bin/env node
/**
 * Renames the packaged Windows launcher to `code.exe` and repoints the `bin/`
 * shims that hardcode its name.
 *
 * Why: the win32 packaging names the executable after `product.json`'s
 * `nameShort` (`picket-code`), while every script, README snippet and muscle
 * memory expects a `code.exe` — and the `bin/` shims upstream generates are
 * already called `code*`. The rename happens here, at packaging time, so the
 * product metadata keeps saying `picket-code` (that is also the user-data folder
 * name on Windows and Linux) while the file on disk is the short one.
 * `process.execPath` keeps working because nothing resolves the launcher by name
 * at runtime.
 *
 * `bin/picket-code.cmd` and `bin/picket-code` do resolve it by name
 * (`"%~dp0..\<nameShort>.exe"`, `NAME="<nameShort>"`), so they are rewritten here.
 * A reference that survives the pass aborts the run rather than shipping a zip
 * whose CLI is broken.
 *
 * Usage: node rename-exe.mjs --app picket-code-win32-x64
 */
import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The launcher name every Windows build ships as, VSCode and its forks alike. */
export const EXECUTABLE = 'code.exe';

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * @param {{ appDir: string, log?: (message: string) => void }} options
 * @returns {Promise<{ renamed: boolean, rewritten: string[] }>}
 */
export async function renameExe(options) {
	const log = options.log ?? (() => { });
	const appDir = options.appDir;
	const productPath = join(appDir, 'resources', 'app', 'product.json');
	let nameShort;
	try {
		nameShort = JSON.parse(await readFile(productPath, 'utf8')).nameShort;
	} catch (error) {
		throw new Error(`cannot read nameShort from ${productPath}: ${error.message}`);
	}
	if (!nameShort) {
		throw new Error(`${productPath} carries no nameShort: cannot tell which launcher to rename`);
	}
	const oldExe = `${nameShort}.exe`;
	const oldPath = join(appDir, oldExe);
	const newPath = join(appDir, EXECUTABLE);

	let renamed = false;
	if (await exists(oldPath)) {
		if (await exists(newPath)) {
			throw new Error(`both ${oldExe} and ${EXECUTABLE} exist in ${appDir}: refusing to guess which is current`);
		}
		await rename(oldPath, newPath);
		renamed = true;
	} else if (!await exists(newPath)) {
		throw new Error(`neither ${oldExe} nor ${EXECUTABLE} exists in ${appDir}: is this a packaged Windows build?`);
	}

	// Explorer looks up the tile manifest by the executable's basename, so a
	// manifest still named after the old launcher is dead weight.
	const oldManifest = join(appDir, `${nameShort}.VisualElementsManifest.xml`);
	const newManifest = join(appDir, 'code.VisualElementsManifest.xml');
	if (await exists(oldManifest)) {
		await rename(oldManifest, newManifest);
	}

	const binDir = join(appDir, 'bin');
	const rewritten = await exists(binDir) ? await rewriteShims({ binDir, nameShort, oldExe }) : [];
	if (rewritten.length > 0) {
		log(`rewrote ${rewritten.join(', ')}`);
	}
	log(renamed ? `renamed ${oldExe} -> ${EXECUTABLE}` : `${EXECUTABLE} was already in place`);
	return { renamed, rewritten };
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {{ binDir: string, nameShort: string, oldExe: string }} options
 * @returns {Promise<string[]>} the shims whose contents changed
 */
async function rewriteShims(options) {
	const { binDir, nameShort, oldExe } = options;
	const changed = [];
	const entries = await readdir(binDir, { withFileTypes: true });
	// `resources/win32/bin/code.sh` sets `NAME="<nameShort>"` and builds the
	// launcher path from it. The boundary keeps `APP_NAME="<applicationName>"`
	// intact — with `nameShort == applicationName` a plain substring replace
	// would rewrite it to `APP_NAME="code"`.
	const nameToken = new RegExp(`(^|[^A-Za-z_])NAME="${escapeRegExp(nameShort)}"`, 'gm');
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const path = join(binDir, entry.name);
		const before = await readFile(path, 'utf8');
		const after = before
			.replaceAll(oldExe, EXECUTABLE)
			.replace(nameToken, (_match, prefix) => `${prefix}NAME="code"`);
		if (after !== before) {
			await writeFile(path, after);
			changed.push(entry.name);
		}
	}

	// The rewrite is exact-case on purpose (a shim's own text is not a setting),
	// so a differently-cased reference survives it — which is exactly why the
	// check is case-insensitive: it must not pass a shim Windows can still start
	// by name while our pattern missed it.
	const stalePattern = new RegExp(`${escapeRegExp(nameShort)}\\.exe|(^|[^A-Za-z_])NAME="${escapeRegExp(nameShort)}"`, 'im');
	const stale = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const text = await readFile(join(binDir, entry.name), 'utf8');
		if (stalePattern.test(text)) {
			stale.push(entry.name);
		}
	}
	if (stale.length > 0) {
		throw new Error(`bin/${stale.join(', bin/')} still refers to ${oldExe}: the launcher would not start`);
	}
	return changed;
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--app') {
			args.app = argv[++i];
		} else if (arg.startsWith('--app=')) {
			args.app = arg.slice('--app='.length);
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	if (!args.app) {
		throw new Error('--app <packaged directory> is required');
	}
	return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const args = parseArgs(process.argv.slice(2));
		await renameExe({ appDir: args.app, log: (message) => console.log(`    ${message}`) });
	} catch (error) {
		console.error(`rename-exe: ${error.message}`);
		process.exit(1);
	}
}
