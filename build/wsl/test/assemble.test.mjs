'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TAG = 'v1.143.1-picket.1-rc.4';
const NAME = `picket-code-server-${TAG}-linux-x64.tar.gz`;
const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

const SCRIPT = fileURLToPath(new URL('../assemble.mjs', import.meta.url));

/** @param {string} [productExtra] */
async function fixtureApp() {
	const app = await mkdtemp(join(tmpdir(), 'picket-assemble-'));
	await mkdir(join(app, 'extensions', 'picket-remote-wsl'), { recursive: true });
	await writeFile(join(app, 'product.json'), JSON.stringify({
		nameShort: 'Picket Code',
		extensionEnabledApiProposals: { 'noware.picket-remote-wsl': ['resolvers', 'contribViewsRemote'] }
	}, null, '\t'));
	return app;
}

async function fixturePayload(dir) {
	await writeFile(join(dir, NAME), PAYLOAD);
	await writeFile(join(dir, 'SHA256SUMS'), `${SHA}  ${NAME}\n`);
	return { payload: join(dir, NAME), sums: join(dir, 'SHA256SUMS') };
}

test('an ondemand build ships the component metadata but no payload', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { sums } = await fixturePayload(work);
		await run('node', [SCRIPT, '--app', app, '--tag', TAG, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);

		const catalog = JSON.parse(await readFile(join(app, 'extensions', 'picket-remote-wsl', 'payloads', 'catalog.json'), 'utf8'));
		assert.equal(catalog.tag, TAG);
		assert.equal(catalog.flavor, 'ondemand');
		assert.equal(catalog.components.length, 1);
		assert.equal(catalog.components[0].file, NAME);
		assert.equal(catalog.components[0].sha256, SHA);
		assert.equal(catalog.components[0].size, PAYLOAD.length);
		assert.equal(catalog.components[0].embedded, false);
		assert.equal(catalog.components[0].embeddedPath, undefined);

		const shipped = await readdir(join(app, 'extensions', 'picket-remote-wsl'), { recursive: true });
		assert.ok(!shipped.some(entry => entry.endsWith('.tar.gz')), 'an ondemand build must not carry the payload');
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('an embedded build copies the payload and records where it landed', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { payload, sums } = await fixturePayload(work);
		await run('node', [SCRIPT, '--app', app, '--tag', TAG, '--flavor', 'embedded', '--payload', payload, '--sums', sums]);

		const shipped = join(app, 'extensions', 'picket-remote-wsl', 'resources', 'wsl-payloads', NAME);
		const bytes = await readFile(shipped);
		assert.ok(bytes.equals(PAYLOAD), 'the payload is copied byte for byte');

		const catalog = JSON.parse(await readFile(join(app, 'extensions', 'picket-remote-wsl', 'payloads', 'catalog.json'), 'utf8'));
		assert.equal(catalog.flavor, 'embedded');
		assert.equal(catalog.components[0].embedded, true);
		assert.equal(catalog.components[0].embeddedPath, `resources/wsl-payloads/${NAME}`);
		assert.equal(catalog.components[0].sha256, SHA);
		assert.equal(catalog.components[0].size, PAYLOAD.length);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('the product.json is stamped with the picket tag', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { sums } = await fixturePayload(work);
		await run('node', [SCRIPT, '--app', app, '--tag', TAG, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);
		const product = JSON.parse(await readFile(join(app, 'product.json'), 'utf8'));
		assert.equal(product.picketTag, TAG);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a payload whose name does not carry the tag is refused', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const wrong = join(work, 'picket-code-server-v9.9.9-linux-x64.tar.gz');
		await writeFile(wrong, PAYLOAD);
		await assert.rejects(
			() => run('node', [SCRIPT, '--app', app, '--tag', TAG, '--flavor', 'embedded', '--payload', wrong]),
			/payload file name does not contain tag/
		);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('an embedded build without a payload fails loudly', async () => {
	const app = await fixtureApp();
	try {
		await assert.rejects(
			() => run('node', [SCRIPT, '--app', app, '--tag', TAG, '--flavor', 'embedded']),
			/--payload/
		);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});
