'use strict';

// Stamps a built Picket Code app with the WSL server component: writes the
// component catalog and, for embedded builds, copies the payload into the
// extension. Run after the platform build, before packaging.
//
//   node assemble.mjs --app <VSCode-win32-x64> --tag <release-tag> --flavor embedded --payload <tar.gz> [--sums <SHA256SUMS>]
//   node assemble.mjs --app <app> --tag <tag> --flavor ondemand --sums <SHA256SUMS> --size <bytes>

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs, payloadName, readSha256Sums, requireArg, runCli, sha256File } from './lib/common.mjs';

const EXTENSION = 'extensions/picket-remote-wsl';

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const app = requireArg(args, 'app');
	const tag = requireArg(args, 'tag');
	const flavor = requireArg(args, 'flavor');
	if (flavor !== 'embedded' && flavor !== 'ondemand') {
		throw new Error(`unknown flavor "${flavor}": use embedded or ondemand`);
	}

	const name = payloadName(tag);
	const extensionDir = join(app, EXTENSION);
	const payloadsDir = join(extensionDir, 'payloads');
	await mkdir(payloadsDir, { recursive: true });

	/** @type {Record<string, unknown>} */
	let component;
	if (flavor === 'embedded') {
		if (!args.payload) {
			throw new Error('embedded builds need --payload <picket-code-server-<tag>-linux-x64.tar.gz>');
		}
		const file = basename(args.payload);
		if (!file.includes(tag)) {
			throw new Error(`payload file name does not contain tag "${tag}": ${file}`);
		}
		const sha256 = await sha256File(args.payload);
		const size = (await stat(args.payload)).size;
		if (args.sums) {
			const expected = (await readSha256Sums(args.sums)).get(file);
			if (expected && expected !== sha256) {
				throw new Error(`sha256 mismatch for ${file}: SHA256SUMS says ${expected}, payload hashes to ${sha256}`);
			}
		}
		const embeddedDir = join(extensionDir, 'resources', 'wsl-payloads');
		await mkdir(embeddedDir, { recursive: true });
		await copyFile(args.payload, join(embeddedDir, file));
		component = {
			id: 'wsl-server', kind: 'server', version: tag, file, size, sha256,
			embedded: true, embeddedPath: `resources/wsl-payloads/${file}`
		};
	} else {
		if (!args.sums) {
			throw new Error('ondemand builds need --sums <SHA256SUMS>');
		}
		if (!args.size || !/^\d+$/.test(args.size) || Number(args.size) <= 0) {
			throw new Error('ondemand builds need --size <bytes> (the payload size from the release)');
		}
		const sha256 = (await readSha256Sums(args.sums)).get(name);
		if (!sha256) {
			throw new Error(`SHA256SUMS has no entry for ${name}`);
		}
		component = {
			id: 'wsl-server', kind: 'server', version: tag, file: name,
			size: Number(args.size), sha256, embedded: false
		};
	}

	const catalog = { version: 1, tag, flavor, components: [component] };
	await writeFile(join(payloadsDir, 'catalog.json'), `${JSON.stringify(catalog, null, '\t')}\n`);

	const productPath = join(app, 'product.json');
	const product = JSON.parse(await readFile(productPath, 'utf8'));
	product.picketTag = tag;
	await writeFile(productPath, `${JSON.stringify(product, null, '\t')}\n`);

	if (flavor === 'ondemand') {
		const shipped = await readdir(extensionDir, { recursive: true });
		const leaked = shipped.filter(entry => entry.endsWith('.tar.gz'));
		if (leaked.length > 0) {
			throw new Error(`ondemand build contains a payload: ${leaked.join(', ')}`);
		}
	}
	console.log(`assembled ${flavor} WSL component ${component.file} (${component.size} bytes) for ${tag}`);
}

runCli(main);
