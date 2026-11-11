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
const MIN = '1.0.0';
const VERSION = '1.4.0';
const COMMIT = 'a'.repeat(40);
const NAME = `picket-code-server-${VERSION}-linux-x64.tar.gz`;
const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

const SCRIPT = fileURLToPath(new URL('../assemble.mjs', import.meta.url));

/**
 * A built app: product.json already carries the vscode commit that the build
 * wrote (gulpfile.vscode.ts:178), which is what a catalog must agree with.
 * @param {{ commit?: string, extra?: Record<string, unknown> }} [options]
 */
async function fixtureApp(options = {}) {
	const app = await mkdtemp(join(tmpdir(), 'picket-assemble-'));
	await mkdir(join(app, 'extensions', 'picket-remote-wsl'), { recursive: true });
	await writeFile(join(app, 'product.json'), JSON.stringify({
		nameShort: 'picket-code',
		commit: options.commit ?? COMMIT,
		extensionEnabledApiProposals: { 'noware.picket-remote-wsl': ['resolvers', 'contribViewsRemote'] },
		...(options.extra ?? {})
	}, null, '\t'));
	return app;
}

/** @param {string} dir */
async function fixturePayload(dir) {
	await writeFile(join(dir, NAME), PAYLOAD);
	await writeFile(join(dir, 'SHA256SUMS'), `${SHA}  ${NAME}\n`);
	return { payload: join(dir, NAME), sums: join(dir, 'SHA256SUMS') };
}

/** @param {string} app */
async function readCatalog(app) {
	return JSON.parse(await readFile(join(app, 'extensions', 'picket-remote-wsl', 'payloads', 'catalog.json'), 'utf8'));
}

/** @param {string} app */
async function readProduct(app) {
	return JSON.parse(await readFile(join(app, 'product.json'), 'utf8'));
}

/** @param {string[]} argv */
async function assemble(argv) {
	try {
		await run('node', [SCRIPT, ...argv]);
		return { code: 0, stderr: '' };
	} catch (error) {
		return { code: error.code ?? 1, stderr: String(error.stderr ?? error.message) };
	}
}

test('stamps the minimum version and the commit, not a tag', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { sums } = await fixturePayload(work);
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--commit', COMMIT, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);
		assert.equal(result.code, 0, result.stderr);

		const product = await readProduct(app);
		assert.equal(product.picketServerMinVersion, MIN);
		assert.equal(product.picketTag, undefined);

		const catalog = await readCatalog(app);
		assert.equal(catalog.schema, 2);
		assert.equal(catalog.minVersion, MIN);
		assert.equal(catalog.flavor, 'ondemand');
		assert.equal(catalog.components.length, 1);
		assert.equal(catalog.components[0].version, VERSION);
		assert.equal(catalog.components[0].commit, COMMIT);
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
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--commit', COMMIT, '--flavor', 'embedded', '--payload', payload, '--sums', sums]);
		assert.equal(result.code, 0, result.stderr);

		const shipped = join(app, 'extensions', 'picket-remote-wsl', 'resources', 'wsl-payloads', NAME);
		const bytes = await readFile(shipped);
		assert.ok(bytes.equals(PAYLOAD), 'the payload is copied byte for byte');

		const catalog = await readCatalog(app);
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

test('the version defaults to the minimum, so an unconfigured build still ships a usable payload', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		await writeFile(join(work, `picket-code-server-${MIN}-linux-x64.tar.gz`), PAYLOAD);
		await writeFile(join(work, 'SHA256SUMS'), `${SHA}  picket-code-server-${MIN}-linux-x64.tar.gz\n`);
		const result = await assemble(['--app', app, '--min-version', MIN, '--flavor', 'ondemand', '--sums', join(work, 'SHA256SUMS'), '--size', String(PAYLOAD.length)]);
		assert.equal(result.code, 0, result.stderr);

		const catalog = await readCatalog(app);
		assert.equal(catalog.minVersion, MIN);
		assert.equal(catalog.components[0].version, MIN);
		assert.equal(catalog.components[0].commit, COMMIT, 'the commit comes from the app product.json when --commit is not given');
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a stale picketTag left over from an rc build is removed', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp({ extra: { picketTag: 'v1.143.1-picket.1-rc.4' } });
	try {
		const { sums } = await fixturePayload(work);
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);
		assert.equal(result.code, 0, result.stderr);
		const product = await readProduct(app);
		assert.equal(product.picketTag, undefined, 'two version stamps would be read by different code paths');
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a payload whose name does not carry the version is refused', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const wrong = join(work, 'picket-code-server-9.9.9-linux-x64.tar.gz');
		await writeFile(wrong, PAYLOAD);
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--flavor', 'embedded', '--payload', wrong]);
		assert.match(result.stderr, /payload file name does not contain version/);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a payload the checksum file does not name is refused instead of being stamped with another hash', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { payload } = await fixturePayload(work);
		await writeFile(join(work, 'SHA256SUMS'), `${SHA}  picket-code-server-1.3.0-linux-x64.tar.gz\n`);
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--commit', COMMIT, '--flavor', 'embedded', '--payload', payload, '--sums', join(work, 'SHA256SUMS')]);
		assert.match(result.stderr, new RegExp(`SHA256SUMS has no entry for ${NAME}`));
		const shipped = await readdir(join(app, 'extensions', 'picket-remote-wsl'), { recursive: true });
		assert.ok(!shipped.some(entry => entry.endsWith('.tar.gz')), 'a refused payload must not be copied into the app');
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a version below the minimum is a configuration error', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp();
	try {
		const { sums } = await fixturePayload(work);
		const result = await assemble(['--app', app, '--min-version', '2.0.0', '--version', VERSION, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);
		assert.match(result.stderr, /1\.4\.0 is below the minimum 2\.0\.0/);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('a non-semver minimum version is refused', async () => {
	const app = await fixtureApp();
	try {
		const result = await assemble(['--app', app, '--min-version', 'v1.143.1-picket.1-rc.4', '--flavor', 'ondemand', '--sums', 'x', '--size', '1']);
		assert.match(result.stderr, /--min-version must be a semver/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('an app without a commit and no --commit cannot be assembled', async () => {
	const work = await mkdtemp(join(tmpdir(), 'picket-assemble-src-'));
	const app = await fixtureApp({ commit: '' });
	try {
		const { sums } = await fixturePayload(work);
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--flavor', 'ondemand', '--sums', sums, '--size', String(PAYLOAD.length)]);
		assert.match(result.stderr, /--commit or product\.json commit/);
	} finally {
		await rm(work, { recursive: true, force: true });
		await rm(app, { recursive: true, force: true });
	}
});

test('an embedded build without a payload fails loudly', async () => {
	const app = await fixtureApp();
	try {
		const result = await assemble(['--app', app, '--min-version', MIN, '--version', VERSION, '--flavor', 'embedded']);
		assert.match(result.stderr, /--payload/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});
