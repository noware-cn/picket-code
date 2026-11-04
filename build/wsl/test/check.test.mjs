'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const TAG = 'v1.143.1-picket.1-rc.4';
const NAME = `picket-code-server-${TAG}-linux-x64.tar.gz`;
const SCRIPT = fileURLToPath(new URL('../check.mjs', import.meta.url));

const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

/**
 * A fake built app: product.json + the extension with a payload and catalog
 * shaped exactly like assemble.mjs writes them.
 * @param {{ flavor?: 'embedded' | 'ondemand', proposals?: boolean, tag?: string, catalogTag?: string, payloadBytes?: Buffer, sumsSha?: string, size?: number }} [options]
 */
async function fixtureApp(options = {}) {
	const app = await mkdtemp(join(tmpdir(), 'picket-check-'));
	const ext = join(app, 'extensions', 'picket-remote-wsl');
	await mkdir(join(ext, 'payloads'), { recursive: true });
	const proposals = options.proposals === false ? {} : { 'noware.picket-remote-wsl': ['resolvers', 'contribViewsRemote'] };
	await writeFile(join(app, 'product.json'), JSON.stringify({ extensionEnabledApiProposals: proposals, picketTag: options.tag ?? TAG }));
	const flavor = options.flavor ?? 'embedded';
	const catalogTag = options.catalogTag ?? TAG;
	const component = {
		id: 'wsl-server', kind: 'server', version: catalogTag, file: NAME,
		size: options.size ?? (options.payloadBytes ?? PAYLOAD).length,
		sha256: options.sumsSha ?? SHA, embedded: flavor === 'embedded'
	};
	if (flavor === 'embedded') {
		await mkdir(join(ext, 'resources', 'wsl-payloads'), { recursive: true });
		await writeFile(join(ext, 'resources', 'wsl-payloads', NAME), options.payloadBytes ?? PAYLOAD);
		component.embeddedPath = `resources/wsl-payloads/${NAME}`;
	}
	await writeFile(join(ext, 'payloads', 'catalog.json'), JSON.stringify({
		version: 1, tag: catalogTag, flavor, components: [component]
	}, null, '\t'));
	return app;
}

/** @param {string[]} args */
async function check(...args) {
	try {
		await run('node', [SCRIPT, ...args]);
		return { code: 0, stderr: '' };
	} catch (error) {
		return { code: error.code ?? 1, stderr: String(error.stderr ?? error.message) };
	}
}

test('a consistent embedded app passes', async () => {
	const app = await fixtureApp();
	try {
		const result = await check('--app', app, '--flavor', 'embedded', '--max-embedded-mb', '110');
		assert.equal(result.code, 0, result.stderr);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('an ondemand build containing a payload fails', async () => {
	const app = await fixtureApp({ flavor: 'ondemand' });
	try {
		// The catalog says ondemand, but someone dropped the payload into the tree.
		await writeFile(join(app, 'extensions', 'picket-remote-wsl', NAME), PAYLOAD);
		const result = await check('--app', app, '--flavor', 'ondemand');
		assert.match(result.stderr, /ondemand build contains a payload/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a catalog tag that disagrees with picketTag fails', async () => {
	const app = await fixtureApp({ catalogTag: 'v0.0.1', tag: TAG });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /catalog version v0\.0\.1 does not match picketTag/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('an embedded build whose payload is missing fails', async () => {
	const app = await fixtureApp();
	try {
		await rm(join(app, 'extensions', 'picket-remote-wsl', 'resources'), { recursive: true, force: true });
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /embedded payload missing/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a payload whose bytes disagree with the catalog digest fails', async () => {
	const app = await fixtureApp({ payloadBytes: Buffer.from('someone-replaced-me') });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /sha256 mismatch/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a product.json without the resolver proposal fails', async () => {
	const app = await fixtureApp({ proposals: false });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /extensionEnabledApiProposals is missing noware\.picket-remote-wsl/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('an embedded payload over the size budget fails', async () => {
	const big = Buffer.alloc(2 * 1024 * 1024, 7);
	const app = await fixtureApp({ payloadBytes: big, sumsSha: createHash('sha256').update(big).digest('hex') });
	try {
		const result = await check('--app', app, '--flavor', 'embedded', '--max-embedded-mb', '1');
		assert.match(result.stderr, /exceeds 1 MB/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});
