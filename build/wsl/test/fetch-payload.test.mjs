'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const VERSION = '1.4.0';
const NAME = `picket-code-server-${VERSION}-linux-x64.tar.gz`;
const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

const SCRIPT = fileURLToPath(new URL('../fetch-payload.sh', import.meta.url));

/**
 * The script stages into `<dirname of itself>/download`, so running a copy keeps
 * the real build/wsl/download/ untouched.
 */
async function stageScript() {
	const dir = await mkdtemp(join(tmpdir(), 'picket-fetch-'));
	await copyFile(SCRIPT, join(dir, 'fetch-payload.sh'));
	return dir;
}

/**
 * A payload tarball laid out like the real one: `product.json` at the archive
 * root, which is the only thing the script reads out of it.
 * @param {string} dir
 * @param {Record<string, unknown>} product
 */
async function payloadTarball(dir, product) {
	const src = join(dir, 'payload-src');
	await mkdir(src, { recursive: true });
	await writeFile(join(src, 'product.json'), JSON.stringify(product));
	const out = join(dir, NAME);
	await run('tar', ['-czf', out, '-C', src, 'product.json']);
	return out;
}

/** @param {string} dir @param {string[]} argv @param {Record<string, string>} [env] */
async function fetchPayload(dir, argv, env = {}) {
	// A token in the ambient environment would send the script down the `gh`
	// path; an empty value keeps it on the plain-HTTPS/from-file path.
	const childEnv = { ...process.env, PICKET_SERVER_TOKEN: '', GH_TOKEN: '', ...env };
	try {
		const { stdout } = await run('bash', [join(dir, 'fetch-payload.sh'), ...argv], { env: childEnv });
		return { code: 0, stdout, stderr: '' };
	} catch (error) {
		return { code: error.code ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message) };
	}
}

test('a payload built from another commit is refused instead of being relabelled', async () => {
	const dir = await stageScript();
	try {
		const payload = await payloadTarball(dir, { version: '1.143.1', commit: OTHER_COMMIT });
		const result = await fetchPayload(dir, [VERSION, '--from-file', payload], { PICKET_SERVER_COMMIT: COMMIT });
		assert.equal(result.code, 1);
		assert.match(result.stderr, /commit mismatch/);
		assert.match(result.stderr, new RegExp(OTHER_COMMIT));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('a payload that carries no commit is refused: the catalog would have nothing to compare', async () => {
	const dir = await stageScript();
	try {
		const payload = await payloadTarball(dir, { version: '1.143.1' });
		const result = await fetchPayload(dir, [VERSION, '--from-file', payload], { PICKET_SERVER_COMMIT: COMMIT });
		assert.equal(result.code, 1);
		assert.match(result.stderr, /cannot read the build commit/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('the catalog records the payload\'s own commit, size and digest', async () => {
	const dir = await stageScript();
	try {
		const payload = await payloadTarball(dir, { version: '1.143.1', commit: COMMIT });
		const result = await fetchPayload(dir, [VERSION, '--from-file', payload], { PICKET_SERVER_COMMIT: COMMIT });
		assert.equal(result.code, 0, result.stderr);

		const download = join(dir, 'download');
		const catalog = JSON.parse(await readFile(join(download, 'catalog.json'), 'utf8'));
		assert.equal(catalog.schema, 2);
		assert.equal(catalog.minVersion, VERSION);
		assert.equal(catalog.components.length, 1);
		assert.equal(catalog.components[0].version, VERSION);
		assert.equal(catalog.components[0].commit, COMMIT);
		assert.equal(catalog.components[0].file, NAME);
		assert.equal(catalog.components[0].size, (await stat(join(download, NAME))).size);
		assert.equal(catalog.components[0].sha256, createHash('sha256').update(await readFile(join(download, NAME))).digest('hex'));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
