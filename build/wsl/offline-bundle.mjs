'use strict';

// Packs the fetched server payload, its SHA256SUMS and the catalog into the
// offline component bundle zip that air-gapped installs consume through
// "Picket: Install WSL Components from File". All inputs live in --dir, laid
// down by fetch-payload.sh.
//
//   node offline-bundle.mjs --dir build/wsl/download --tag <tag> --out <bundle.zip>

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { componentFor, parseArgs, payloadName, readSha256Sums, requireArg, runCli, sha256File } from './lib/common.mjs';

const run = promisify(execFile);

/**
 * Zip the bundle entries flat. Info-ZIP on POSIX, Compress-Archive on Windows
 * runners, where no zip binary ships.
 * @param {string[]} entries absolute paths
 * @param {string} out
 */
async function zipEntries(entries, out) {
	if (process.platform === 'win32') {
		const list = entries.map(path => `'${path.replace(/'/g, "''")}'`).join(',');
		const destination = `'${out.replace(/'/g, "''")}'`;
		await run('powershell.exe', ['-NoProfile', '-Command',
			`Compress-Archive -LiteralPath @(${list}) -DestinationPath ${destination} -Force`]);
	} else {
		await run('zip', ['-j', '-X', out, ...entries]);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const dir = requireArg(args, 'dir');
	const tag = requireArg(args, 'tag');
	const out = requireArg(args, 'out');

	const name = payloadName(tag);
	const payloadPath = join(dir, name);
	await stat(payloadPath);

	const expected = (await readSha256Sums(join(dir, 'SHA256SUMS'))).get(name);
	if (!expected) {
		throw new Error(`SHA256SUMS has no entry for ${name}`);
	}
	const sha256 = await sha256File(payloadPath);
	if (sha256 !== expected) {
		throw new Error(`sha256 mismatch for ${name}: SHA256SUMS says ${expected}, payload hashes to ${sha256}`);
	}

	const catalogPath = join(dir, 'catalog.json');
	const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
	if (catalog.tag !== tag) {
		throw new Error(`catalog version ${catalog.tag} does not match tag ${tag}`);
	}
	if (!componentFor(catalog, name)) {
		throw new Error(`the catalog has no component for ${name}`);
	}

	await rm(out, { force: true });
	await zipEntries([payloadPath, join(dir, 'SHA256SUMS'), catalogPath], out);
	console.log(`offline bundle written to ${out}`);
}

runCli(main);
