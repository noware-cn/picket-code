import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameExe, EXECUTABLE } from '../rename-exe.mjs';

const CMD_SHIM = [
	'@echo off',
	'setlocal',
	'set ELECTRON_RUN_AS_NODE=1',
	'"%~dp0..\\picket-code.exe" "%~dp0..\\resources\\app\\out\\cli.js" %*',
	'IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%',
	'endlocal',
	''
].join('\r\n');

const SH_SHIM = [
	'#!/usr/bin/env sh',
	'APP_NAME="picket-code"',
	'VSCODE_PATH="$(dirname "$(dirname "$(readlink -f "$0")")")"',
	'NAME="picket-code"',
	'ELECTRON="$VSCODE_PATH/$NAME.exe"',
	'exec "$ELECTRON" "$VSCODE_PATH/resources/app/out/cli.js" "$@"',
	''
].join('\n');

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** A packaged win32 tree just close enough to the real one for the rename. */
async function fixture(options = {}) {
	const appDir = await mkdtemp(join(tmpdir(), 'picket-rename-'));
	await mkdir(join(appDir, 'resources', 'app'), { recursive: true });
	await mkdir(join(appDir, 'bin'), { recursive: true });
	await writeFile(join(appDir, 'resources', 'app', 'product.json'), `${JSON.stringify({ nameShort: 'picket-code', applicationName: 'picket-code' }, undefined, '\t')}\n`);
	const exe = options.exeName ?? 'picket-code.exe';
	await writeFile(join(appDir, exe), Buffer.from('MZ fake launcher'));
	await writeFile(join(appDir, 'picket-code.VisualElementsManifest.xml'), '<Application />\n');
	await writeFile(join(appDir, 'bin', 'picket-code.cmd'), CMD_SHIM);
	await writeFile(join(appDir, 'bin', 'picket-code'), SH_SHIM);
	return appDir;
}

test('renames the launcher and repoints both shims', async () => {
	const appDir = await fixture();
	try {
		const result = await renameExe({ appDir });

		assert.equal(result.renamed, true);
		assert.equal(await exists(join(appDir, 'picket-code.exe')), false);
		assert.equal(await readFile(join(appDir, EXECUTABLE), 'utf8'), 'MZ fake launcher');

		const cmd = await readFile(join(appDir, 'bin', 'picket-code.cmd'), 'utf8');
		assert.ok(cmd.includes('"%~dp0..\\code.exe"'), cmd);
		assert.ok(!cmd.includes('picket-code.exe'), cmd);

		const sh = await readFile(join(appDir, 'bin', 'picket-code'), 'utf8');
		assert.ok(sh.includes('NAME="code"'), sh);
		assert.doesNotMatch(sh, /(^|[^A-Za-z_])NAME="picket-code"/m);
		assert.ok(sh.includes('APP_NAME="picket-code"'), 'the app name is not the launcher name');

		// Explorer finds the tile manifest by the launcher basename.
		assert.equal(await exists(join(appDir, 'picket-code.VisualElementsManifest.xml')), false);
		assert.equal(await exists(join(appDir, 'code.VisualElementsManifest.xml')), true);
	} finally {
		await rm(appDir, { recursive: true, force: true });
	}
});

test('a second run is a no-op instead of a failure', async () => {
	const appDir = await fixture();
	try {
		await renameExe({ appDir });
		const again = await renameExe({ appDir });
		assert.equal(again.renamed, false);
		assert.deepEqual(again.rewritten, []);
		assert.equal(await readFile(join(appDir, EXECUTABLE), 'utf8'), 'MZ fake launcher');
	} finally {
		await rm(appDir, { recursive: true, force: true });
	}
});

test('refuses a tree with no launcher at all', async () => {
	const appDir = await fixture();
	try {
		await rm(join(appDir, 'picket-code.exe'));
		await assert.rejects(() => renameExe({ appDir }), /neither picket-code\.exe nor code\.exe exists/);
	} finally {
		await rm(appDir, { recursive: true, force: true });
	}
});

test('refuses a tree carrying both launchers', async () => {
	const appDir = await fixture();
	try {
		await writeFile(join(appDir, EXECUTABLE), Buffer.from('MZ stale launcher'));
		await assert.rejects(() => renameExe({ appDir }), /refusing to guess/);
	} finally {
		await rm(appDir, { recursive: true, force: true });
	}
});

test('fails when a shim refers to the old launcher in a casing the rewrite misses', async () => {
	const appDir = await fixture();
	try {
		// Windows starts `picket-code.EXE` all the same; a shim that spells it that
		// way survives the exact-case rewrite and must not be shipped.
		await writeFile(join(appDir, 'bin', 'legacy.cmd'), '"%~dp0..\\picket-code.EXE" %*\r\n');
		await assert.rejects(() => renameExe({ appDir }), /bin\/legacy\.cmd still refers to picket-code\.exe/);
	} finally {
		await rm(appDir, { recursive: true, force: true });
	}
});
