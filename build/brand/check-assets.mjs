#!/usr/bin/env node
/**
 * Guard the shipped brand assets.
 *
 * The icons under vscode/resources are binaries nobody reads, so a re-merge with
 * upstream can quietly restore the VS Code logo. This checks that each file is
 * present, parses with the frame sizes the platform expects, and is not the
 * upstream file byte for byte.
 *
 * Usage: node build/brand/check-assets.mjs [--repo-root <dir>]
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(process.argv.includes('--repo-root')
	? process.argv[process.argv.indexOf('--repo-root') + 1]
	: join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const failures = [];
const check = (ok, message) => {
	if (!ok) { failures.push(message); }
	return ok;
};

/** Upstream 1.143.1 hashes: if one comes back, the mark was lost in a merge. */
const UPSTREAM_MD5 = {
	'vscode/resources/win32/code.ico': '771605b7ef806c0199ac3f55157c19da',
	'vscode/resources/darwin/code.icns': '7963bea9239f2c57c764ba37b498ddb2',
	'vscode/resources/linux/code.png': '7c99e55abcd3052655217c7bc020a2ec',
	'vscode/resources/win32/code_70x70.png': 'd78f75d7554c49a2f1a182aeee20747f',
	'vscode/resources/win32/code_150x150.png': '48a0886014ce752aa5886e441ecd0cff',
	'vscode/resources/server/favicon.ico': 'ad4e35da54832cc2d90471b8f9a57b0a',
	'vscode/resources/server/code-192.png': '7c99e55abcd3052655217c7bc020a2ec',
	'vscode/resources/server/code-512.png': '7c99e55abcd3052655217c7bc020a2ec',
};

const read = relative => {
	const path = join(repoRoot, relative);
	if (!check(existsSync(path), `${relative}: missing`)) { return undefined; }
	return readFileSync(path);
};

function checkNotUpstream(relative, buffer) {
	const md5 = createHash('md5').update(buffer).digest('hex');
	check(md5 !== UPSTREAM_MD5[relative], `${relative}: still the upstream VS Code asset`);
}

function pngSize(buffer, relative) {
	const signature = buffer.subarray(0, 8).toString('hex');
	if (!check(signature === '89504e470d0a1a0a', `${relative}: not a PNG`)) { return undefined; }
	if (!check(buffer.subarray(12, 16).toString('ascii') === 'IHDR', `${relative}: missing IHDR`)) { return undefined; }
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkIco(buffer, relative) {
	check(buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1, `${relative}: not an ICO`);
	const count = buffer.readUInt16LE(4);
	const sizes = [];
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		sizes.push(buffer[entry] === 0 ? 256 : buffer[entry]);
	}
	const expected = [16, 24, 32, 48, 64, 128, 256];
	check(
		JSON.stringify([...sizes].sort((a, b) => a - b)) === JSON.stringify(expected),
		`${relative}: frame sizes are [${sizes.join(', ')}], expected [${expected.join(', ')}]`,
	);
	check(buffer.includes(Buffer.from('PNG')), `${relative}: frames should be PNG encoded`);
}

function checkIcns(buffer, relative) {
	if (!check(buffer.subarray(0, 4).toString('ascii') === 'icns', `${relative}: not an ICNS`)) { return; }
	check(buffer.readUInt32BE(4) === buffer.length, `${relative}: header length ${buffer.readUInt32BE(4)} != file size ${buffer.length}`);
	const expected = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
	const seen = {};
	let offset = 8;
	while (offset < buffer.length) {
		const kind = buffer.subarray(offset, offset + 4).toString('ascii');
		const length = buffer.readUInt32BE(offset + 4);
		if (!check(length > 8 && offset + length <= buffer.length, `${relative}: bad chunk ${kind} length ${length}`)) { return; }
		const png = buffer.subarray(offset + 8, offset + length);
		const size = pngSize(png, `${relative}:${kind}`);
		if (size) { seen[kind] = size; }
		offset += length;
	}
	for (const [kind, px] of Object.entries(expected)) {
		const size = seen[kind];
		check(size && size.width === px && size.height === px, `${relative}: ${kind} should be ${px}x${px}, got ${size ? `${size.width}x${size.height}` : 'nothing'}`);
	}
}

// --- Windows, macOS, Linux application icons ---------------------------------
const ico = read('vscode/resources/win32/code.ico');
if (ico) { checkIco(ico, 'vscode/resources/win32/code.ico'); checkNotUpstream('vscode/resources/win32/code.ico', ico); }

const icns = read('vscode/resources/darwin/code.icns');
if (icns) { checkIcns(icns, 'vscode/resources/darwin/code.icns'); checkNotUpstream('vscode/resources/darwin/code.icns', icns); }

const webFavicon = read('vscode/resources/server/favicon.ico');
if (webFavicon) { checkIco(webFavicon, 'vscode/resources/server/favicon.ico'); checkNotUpstream('vscode/resources/server/favicon.ico', webFavicon); }

for (const [relative, px] of [
	['vscode/resources/linux/code.png', 512],
	['vscode/resources/win32/code_70x70.png', 70],
	['vscode/resources/win32/code_150x150.png', 150],
	['vscode/extensions/picket-remote-wsl/resources/icon.png', 128],
	['vscode/resources/server/code-192.png', 192],
	['vscode/resources/server/code-512.png', 512],
]) {
	const buffer = read(relative);
	if (!buffer) { continue; }
	const size = pngSize(buffer, relative);
	check(size?.width === px && size?.height === px, `${relative}: expected ${px}x${px}, got ${size ? `${size.width}x${size.height}` : 'nothing'}`);
	if (UPSTREAM_MD5[relative]) { checkNotUpstream(relative, buffer); }
}

// --- Open Graph banner -------------------------------------------------------
const og = read('website/docs/public/og-image.png');
if (og) {
	const size = pngSize(og, 'website/docs/public/og-image.png');
	check(size?.width === 1200 && size?.height === 630, `website/docs/public/og-image.png: expected 1200x630, got ${size ? `${size.width}x${size.height}` : 'nothing'}`);
	const publicCopy = read('website/public/og-image.png');
	check(publicCopy && publicCopy.equals(og), 'website/public/og-image.png differs from the docs copy');
}

// --- In-app surfaces ---------------------------------------------------------
const EMBLEM = 'M0 0h58v40L40 58H0z'; // the first module of favicon.svg
for (const name of ['light', 'dark', 'hcLight', 'hcDark']) {
	const relative = `vscode/src/vs/workbench/browser/parts/editor/media/letterpress-${name}.svg`;
	const svg = read(relative)?.toString('utf8');
	if (svg === undefined) { continue; }
	check(svg.includes(EMBLEM), `${relative}: editor watermark is not the Picket emblem`);
}

const loopback = read('vscode/src/vs/workbench/api/node/loopbackServer.ts')?.toString('utf8');
if (loopback !== undefined) {
	check(!loopback.includes('data:image/png;base64,iVBOR'), 'loopbackServer.ts: still embeds the upstream VS Code logo PNG');
	check(loopback.includes('Picket Code ships its own emblem'), 'loopbackServer.ts: default logo is not the Picket emblem');
}

// --- Report ------------------------------------------------------------------
if (failures.length) {
	console.error(`==> ${failures.length} brand asset check(s) failed:`);
	for (const failure of failures) { console.error(`    - ${failure}`); }
	process.exit(1);
}
console.log('==> brand assets ok (Windows ICO, macOS ICNS, Linux PNG, extension icon, OG banner, watermark, loopback logo)');
