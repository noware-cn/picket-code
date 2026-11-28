'use strict';

// fake-wsl.mjs stands in for wsl.exe; real wsl.exe forwards only the env vars
// listed in WSLENV. Wholesale inheritance leaked the dev window's environment
// (VSCODE_DEV=1) into the distro, and the server then registered
// out/bootstrap-import.js — a file only dev builds have — and crashed
// (acceptance --remote, 2026-11-04).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const FAKE = fileURLToPath(new URL('../../../vscode/test/wsl-harness/fake-wsl.mjs', import.meta.url));

test('the distro side only sees HOME, PATH and the WSLENV-listed vars', { skip: process.platform !== 'linux' }, async () => {
	const home = await mkdtemp(join(tmpdir(), 'picket-fake-wsl-env-'));
	try {
		const { stdout } = await run(process.execPath, [FAKE, '-d', 'Distro', '-e', 'sh', '-c', 'printenv'], {
			env: {
				PATH: process.env.PATH,
				PICKET_WSL_FAKE_HOME: home,
				PICKET_WSL_DISTRO: 'Distro',
				VSCODE_DEV: '1',
				ELECTRON_RUN_AS_NODE: '1',
				SECRET_LEAK: 'must-not-pass',
				WSLENV: 'WSL_HARNESS_FOLDER:WIN_ONLY/w',
				WSL_HARNESS_FOLDER: '/expected/folder',
				WIN_ONLY: 'must-not-pass'
			}
		});
		const lines = new Map(stdout.trim().split('\n').map(line => {
			const eq = line.indexOf('=');
			return [line.slice(0, eq), line.slice(eq + 1)];
		}));
		assert.strictEqual(lines.get('HOME'), home, 'the fake home becomes HOME');
		assert.strictEqual(lines.get('WSL_HARNESS_FOLDER'), '/expected/folder', 'WSLENV vars pass through');
		assert.ok(!lines.has('VSCODE_DEV'), 'dev-build env must not leak');
		assert.ok(!lines.has('ELECTRON_RUN_AS_NODE'), 'electron env must not leak');
		assert.ok(!lines.has('SECRET_LEAK'), 'arbitrary env must not leak');
		assert.ok(!lines.has('WIN_ONLY'), '/w entries stay on the Windows side');
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
