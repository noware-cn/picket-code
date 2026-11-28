'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
const SCRIPT = fileURLToPath(new URL('../check.mjs', import.meta.url));

const PAYLOAD = Buffer.from('fake-payload-bytes');
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

/**
 * A fake built app: product.json + the extension with a payload and catalog
 * shaped exactly like assemble.mjs writes them.
 * @param {{
 *   flavor?: 'embedded' | 'ondemand',
 *   proposals?: boolean,
 *   minVersion?: string,
 *   catalogMinVersion?: string,
 *   version?: string,
 *   commit?: string,
 *   componentCommit?: string,
 *   schema?: number,
 *   productMinVersion?: string | undefined,
 *   payloadBytes?: Buffer,
 *   sumsSha?: string,
 *   size?: number
 * }} [options]
 */
async function fixtureApp(options = {}) {
	const app = await mkdtemp(join(tmpdir(), 'picket-check-'));
	const ext = join(app, 'extensions', 'picket-remote-wsl');
	await mkdir(join(ext, 'payloads'), { recursive: true });
	const proposals = options.proposals === false ? {} : { 'noware.picket-remote-wsl': ['resolvers', 'contribViewsRemote'] };
	/** @type {Record<string, unknown>} */
	const product = {
		extensionEnabledApiProposals: proposals,
		commit: options.commit ?? COMMIT
	};
	const min = 'productMinVersion' in options ? options.productMinVersion : (options.minVersion ?? MIN);
	if (min !== undefined) {
		product.picketServerMinVersion = min;
	}
	await writeFile(join(app, 'product.json'), JSON.stringify(product));

	const flavor = options.flavor ?? 'embedded';
	const bytes = options.payloadBytes ?? PAYLOAD;
	const fileName = `picket-code-server-${options.version ?? VERSION}-linux-x64.tar.gz`;
	/** @type {Record<string, unknown>} */
	const component = {
		id: 'wsl-server', kind: 'server',
		version: options.version ?? VERSION,
		commit: options.componentCommit ?? COMMIT,
		file: fileName,
		size: options.size ?? bytes.length,
		sha256: options.sumsSha ?? SHA,
		embedded: flavor === 'embedded'
	};
	if (flavor === 'embedded') {
		await mkdir(join(ext, 'resources', 'wsl-payloads'), { recursive: true });
		await writeFile(join(ext, 'resources', 'wsl-payloads', fileName), bytes);
		component.embeddedPath = `resources/wsl-payloads/${fileName}`;
	}
	await writeFile(join(ext, 'payloads', 'catalog.json'), JSON.stringify({
		schema: options.schema ?? 2,
		minVersion: options.catalogMinVersion ?? options.minVersion ?? MIN,
		flavor,
		components: [component]
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

test('a catalog whose highest version is below the minimum fails the build', async () => {
	const app = await fixtureApp({ version: '0.9.0' });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /catalog offers 0\.9\.0, requires >= 1\.0\.0/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a catalog for another commit fails the build', async () => {
	const app = await fixtureApp({ componentCommit: 'b'.repeat(40) });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, new RegExp(`no server component for commit ${COMMIT}`));
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a catalog minVersion that disagrees with the product stamp fails', async () => {
	const app = await fixtureApp({ catalogMinVersion: '1.2.0' });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /catalog minVersion 1\.2\.0 does not match picketServerMinVersion 1\.0\.0/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a schema 1 catalog is refused instead of being read as current', async () => {
	const app = await fixtureApp({ schema: 1 });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /catalog schema 1 is not 2/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a product without a minimum version stamp cannot be checked', async () => {
	const app = await fixtureApp({ productMinVersion: undefined });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /picketServerMinVersion is missing/);
	} finally {
		await rm(app, { recursive: true, force: true });
	}
});

test('a component version that is not semver is refused', async () => {
	const app = await fixtureApp({ version: 'v1.143.1-picket.1-rc.4', minVersion: MIN });
	try {
		const result = await check('--app', app, '--flavor', 'embedded');
		assert.match(result.stderr, /is not a semver version/);
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
