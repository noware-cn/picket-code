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
const TAG = 'v1.143.1-picket.1-rc.4';
const NAME = `picket-code-server-${TAG}-linux-x64.tar.gz`;
const SCRIPT = fileURLToPath(new URL('../offline-bundle.mjs', import.meta.url));
const UNPACK = new URL('../../../vscode/extensions/picket-remote-wsl/src/offline.js', import.meta.url);

const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

/**
 * The same inputs assemble.mjs leaves behind in build/wsl/download/.
 * @param {string} dir
 */
async function fixtureInputs(dir) {
	await writeFile(join(dir, NAME), PAYLOAD);
	await writeFile(join(dir, 'SHA256SUMS'), `${SHA}  ${NAME}\n`);
	await writeFile(join(dir, 'catalog.json'), JSON.stringify({
		version: 1, tag: TAG, flavor: 'ondemand',
		components: [{ id: 'wsl-server', kind: 'server', version: TAG, file: NAME, size: PAYLOAD.length, sha256: SHA, embedded: false }]
	}, null, '\t'));
}

test('the offline bundle carries exactly the payload, the sums and the catalog', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-bundle-'));
	try {
		await fixtureInputs(work);
		const out = join(work, 'picket-code-offline-wsl.zip');
		await run('node', [SCRIPT, '--dir', work, '--tag', TAG, '--out', out]);

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
		await run('node', [SCRIPT, '--dir', work, '--tag', TAG, '--out', out]);

		const { unpackOfflineBundle } = await import(UNPACK.href);
		const unpacked = await unpackOfflineBundle({ bundlePath: out });
		assert.equal(unpacked.payloadSha256, SHA);
		assert.equal(unpacked.catalog.tag, TAG);
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
		const out = join(work, 'bundle.zip');
		await assert.rejects(
			() => run('node', [SCRIPT, '--dir', work, '--tag', TAG, '--out', out]),
			/SHA256SUMS/
		);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
});
