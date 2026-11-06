'use strict';

// Stamps a built Picket Code app with the WSL server component: writes the
// component catalog and, for embedded builds, copies the payload into the
// extension. Run after the platform build, before packaging.
//
//   node assemble.mjs --app <app> --min-version <x.y.z> [--version <x.y.z>] [--commit <40hex>] \
//        --flavor embedded --payload <tar.gz> [--sums <SHA256SUMS>]
//   node assemble.mjs --app <app> --min-version <x.y.z> [--version <x.y.z>] [--commit <40hex>] \
//        --flavor ondemand --sums <SHA256SUMS> --size <bytes>
//
// --version defaults to the minimum, so a release that only ever cut one server
// version does not have to set both. --commit defaults to the one the upstream
// build wrote into product.json (gulpfile.vscode.ts:178): that is the value the
// client sends in the handshake, so the catalog must carry the same one.

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { compareVersions, parseArgs, payloadName, readSha256Sums, requireArg, requireSemver, runCli, sha256File } from './lib/common.mjs';

const EXTENSION = 'extensions/picket-remote-wsl';

/**
 * @param {string} explicit
 * @param {string} app
 */
async function resolveCommit(explicit, app) {
	const fromProduct = explicit ? '' : JSON.parse(await readFile(join(app, 'product.json'), 'utf8')).commit;
	const commit = explicit || fromProduct;
	if (!commit) {
		throw new Error('--commit or product.json commit is required: a catalog component is matched to a client by commit');
	}
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		throw new Error(`commit "${commit}" is not a 40-character hex sha`);
	}
	return commit;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const app = requireArg(args, 'app');
	const flavor = requireArg(args, 'flavor');
	if (flavor !== 'embedded' && flavor !== 'ondemand') {
		throw new Error(`unknown flavor "${flavor}": use embedded or ondemand`);
	}
	const minVersion = requireSemver(requireArg(args, 'min-version'), '--min-version');
	const version = args.version ? requireSemver(args.version, '--version') : minVersion;
	if (compareVersions(version, minVersion) < 0) {
		throw new Error(`version ${version} is below the minimum ${minVersion}: this build would refuse its own payload`);
	}
	const commit = await resolveCommit(args.commit, app);

	const name = payloadName(version);
	const extensionDir = join(app, EXTENSION);
	const payloadsDir = join(extensionDir, 'payloads');
	await mkdir(payloadsDir, { recursive: true });

	/** @type {Record<string, unknown>} */
	let component;
	if (flavor === 'embedded') {
		if (!args.payload) {
			throw new Error('embedded builds need --payload <picket-code-server-<version>-linux-x64.tar.gz>');
		}
		const file = basename(args.payload);
		if (!file.includes(version)) {
			throw new Error(`payload file name does not contain version "${version}": ${file}`);
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
			id: 'wsl-server', kind: 'server', version, commit, file, size, sha256,
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
			id: 'wsl-server', kind: 'server', version, commit, file: name,
			size: Number(args.size), sha256, embedded: false
		};
	}

	const catalog = { schema: 2, minVersion, flavor, components: [component] };
	await writeFile(join(payloadsDir, 'catalog.json'), `${JSON.stringify(catalog, null, '\t')}\n`);

	const productPath = join(app, 'product.json');
	const product = JSON.parse(await readFile(productPath, 'utf8'));
	product.picketServerMinVersion = minVersion;
	// The old stamp tied the client tag to the server tag; leaving it behind
	// would let two different stamps disagree about which server is right.
	delete product.picketTag;
	await writeFile(productPath, `${JSON.stringify(product, null, '\t')}\n`);

	if (flavor === 'ondemand') {
		const shipped = await readdir(extensionDir, { recursive: true });
		const leaked = shipped.filter(entry => entry.endsWith('.tar.gz'));
		if (leaked.length > 0) {
			throw new Error(`ondemand build contains a payload: ${leaked.join(', ')}`);
		}
	}
	console.log(`assembled ${flavor} WSL component ${component.file} (${component.size} bytes): server ${version} for commit ${commit}, minimum ${minVersion}`);
}

runCli(main);
