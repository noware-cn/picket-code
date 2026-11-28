'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assetSizeFromHeaders } from '../lib/common.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../lib/asset-size.mjs', import.meta.url));

// Captured from a real anonymous request for the rc.4 payload: github.com answers
// with a redirect whose own Content-Length is 0, the CDN host knows the truth.
const REAL_DUMP = [
	'HTTP/1.1 302 Found',
	'Content-Type: text/html; charset=utf-8',
	'Location: https://release-assets.githubusercontent.com/github-production-release-asset/…',
	'X-Content-Type-Options: nosniff',
	'Content-Length: 0',
	'',
	'HTTP/1.1 200 OK',
	'Content-Length: 87754427',
	'Content-Type: application/octet-stream',
	''
].join('\n');

test('the size comes from the last hop, not the redirect', () => {
	assert.equal(assetSizeFromHeaders(REAL_DUMP), 87754427);
});

test('a proxy CONNECT line and a lone zero are not mistaken for the size', () => {
	const dump = ['HTTP/1.1 200 Connection established', '', 'HTTP/1.1 200 OK', 'Content-Length: 0', ''].join('\n');
	assert.equal(assetSizeFromHeaders(dump), 0);
});

test('CRLF dumps parse too', () => {
	assert.equal(assetSizeFromHeaders('HTTP/1.1 200 OK\r\nContent-Length: 1024\r\n\r\n'), 1024);
});

test('the CLI prints the size and refuses a dump without one', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'picket-asset-size-'));
	try {
		const good = join(dir, 'good.txt');
		await writeFile(good, REAL_DUMP);
		const { stdout } = await run(process.execPath, [CLI, good]);
		assert.equal(stdout.trim(), '87754427');

		const bad = join(dir, 'bad.txt');
		await writeFile(bad, 'HTTP/1.1 404 Not Found\nContent-Length: 0\n');
		await assert.rejects(() => run(process.execPath, [CLI, bad]), /no Content-Length/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('the CLI rejects a missing argument instead of printing 0', async () => {
	await assert.rejects(() => run(process.execPath, [CLI]), /usage/);
});
