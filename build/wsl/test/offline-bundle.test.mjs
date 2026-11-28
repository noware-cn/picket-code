'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const MIN = '1.0.0';
const VERSION = '1.4.0';
const COMMIT = 'a'.repeat(40);
const NAME = `picket-code-server-${VERSION}-linux-x64.tar.gz`;
const SCRIPT = fileURLToPath(new URL('../offline-bundle.mjs', import.meta.url));
const UNPACK = new URL('../../../vscode/extensions/picket-remote-wsl/src/offline.js', import.meta.url);

const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

/**
 * The same inputs fetch-payload.sh leaves behind in build/wsl/download/.
 * @param {string} dir
 * @param {{ minVersion?: string, commit?: string }} [options]
 */
async function fixtureInputs(dir, options = {}) {
	await writeFile(join(dir, NAME), PAYLOAD);
	await writeFile(join(dir, 'SHA256SUMS'), `${SHA}  ${NAME}\n`);
	await writeFile(join(dir, 'catalog.json'), JSON.stringify({
		schema: 2, minVersion: options.minVersion ?? MIN, flavor: 'ondemand',
		components: [{
			id: 'wsl-server', kind: 'server', version: VERSION, commit: options.commit ?? COMMIT,
			file: NAME, size: PAYLOAD.length, sha256: SHA, embedded: false
		}]
	}, null, '\t'));
}

/** @param {string[]} argv */
async function bundle(argv) {
	try {
		await run('node', [SCRIPT, ...argv]);
		return { code: 0, stderr: '' };
	} catch (error) {
		return { code: error.code ?? 1, stderr: String(error.stderr ?? error.message) };
	}
}

test('the offline bundle carries exactly the payload, the sums and the catalog', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-bundle-'));
	try {
		await fixtureInputs(work);
		const out = join(work, 'picket-code-offline-wsl.zip');
		const result = await bundle(['--dir', work, '--version', VERSION, '--min-version', MIN, '--out', out]);
		assert.equal(result.code, 0, result.stderr);

		const listing = await run('unzip', ['-l', out]);
		const names = listing.stdout.split('\n').map(line => line.trim().split(/\s+/).pop());
		assert.ok(names.includes(NAME), `zip misses the payload: ${listing.stdout}`);
		assert.ok(names.includes('SHA256SUMS'));
		assert.ok(names.includes('catalog.json'));
		assert.equal(names.filter(name => name?.endsWith('.tar.gz')).length, 1, 'exactly one payload');
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});

test('the bundle unpacks with the extension reader and the digest still matches', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-bundle-'));
	try {
		await fixtureInputs(work);
		const out = join(work, 'picket-code-offline-wsl.zip');
		const result = await bundle(['--dir', work, '--version', VERSION, '--min-version', MIN, '--out', out]);
		assert.equal(result.code, 0, result.stderr);

		const { unpackOfflineBundle } = await import(UNPACK.href);
		const unpacked = await unpackOfflineBundle({ bundlePath: out });
		assert.equal(unpacked.payloadSha256, SHA);
		assert.equal(unpacked.catalog.schema, 2);
		assert.equal(unpacked.catalog.minVersion, MIN);
		assert.equal(unpacked.catalog.components[0].commit, COMMIT);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});

test('a catalog whose minimum version disagrees with the build is refused', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-bundle-'));
	try {
		await fixtureInputs(work, { minVersion: '2.0.0' });
		const result = await bundle(['--dir', work, '--version', VERSION, '--min-version', MIN, '--out', join(work, 'bundle.zip')]);
		assert.match(result.stderr, /catalog minVersion 2\.0\.0 does not match --min-version 1\.0\.0/);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});

test('a bundle whose payload is missing from the sums is refused', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-bundle-'));
	try {
		await writeFile(join(work, NAME), PAYLOAD);
		await writeFile(join(work, 'SHA256SUMS'), `${SHA}  some-other-file.tar.gz\n`);
		await writeFile(join(work, 'catalog.json'), '{}');
		const result = await bundle(['--dir', work, '--version', VERSION, '--min-version', MIN, '--out', join(work, 'bundle.zip')]);
		assert.match(result.stderr, /SHA256SUMS/);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});
