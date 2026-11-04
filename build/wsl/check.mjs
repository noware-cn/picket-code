'use strict';

// Verifies that a built app's WSL component is self-consistent before it is
// packaged: the catalog agrees with product.json, the resolver proposal is
// enabled, embedded payloads are present with the right bytes, and ondemand
// builds carry no payload at all. Run in packaging, never in the extension.
//
//   node check.mjs --app <app> --flavor embedded --max-embedded-mb 110

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { componentFor, parseArgs, payloadName, requireArg, runCli, sha256File } from './lib/common.mjs';

const EXTENSION = 'extensions/picket-remote-wsl';
const DEFAULT_MAX_EMBEDDED_MB = 110;

/**
 * Total bytes of every file under `root`, recursively.
 * @param {string} root
 */
async function directorySize(root) {
	let total = 0;
	const stack = [root];
	while (stack.length > 0) {
		const dir = /** @type {string} */ (stack.pop());
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(path);
			} else {
				total += (await stat(path)).size;
			}
		}
	}
	return total;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const app = requireArg(args, 'app');
	const flavor = requireArg(args, 'flavor');
	if (flavor !== 'embedded' && flavor !== 'ondemand') {
		throw new Error(`unknown flavor "${flavor}": use embedded or ondemand`);
	}
	const maxEmbeddedMb = args['max-embedded-mb'] ? Number(args['max-embedded-mb']) : DEFAULT_MAX_EMBEDDED_MB;

	const extensionDir = join(app, EXTENSION);
	const product = JSON.parse(await readFile(join(app, 'product.json'), 'utf8'));
	const catalog = JSON.parse(await readFile(join(extensionDir, 'payloads', 'catalog.json'), 'utf8'));

	const proposals = product.extensionEnabledApiProposals ?? {};
	if (!Array.isArray(proposals['noware.picket-remote-wsl'])) {
		throw new Error('product.json extensionEnabledApiProposals is missing noware.picket-remote-wsl');
	}
	if (catalog.tag !== product.picketTag) {
		throw new Error(`catalog version ${catalog.tag} does not match picketTag ${product.picketTag}`);
	}
	if (catalog.flavor !== flavor) {
		throw new Error(`catalog flavor ${catalog.flavor} does not match --flavor ${flavor}`);
	}

	const name = payloadName(catalog.tag);
	const component = componentFor(catalog, name);
	if (!component) {
		throw new Error(`the catalog has no component for ${name}`);
	}

	if (flavor === 'embedded') {
		if (!component.embeddedPath) {
			throw new Error(`embedded catalog entry for ${name} has no embeddedPath`);
		}
		const payloadPath = join(extensionDir, component.embeddedPath);
		let payloadStat;
		try {
			payloadStat = await stat(payloadPath);
		} catch {
			throw new Error(`embedded payload missing: ${component.embeddedPath}`);
		}
		const sha256 = await sha256File(payloadPath);
		if (sha256 !== component.sha256) {
			throw new Error(`sha256 mismatch for ${component.file}: catalog says ${component.sha256}, payload hashes to ${sha256}`);
		}
		if (payloadStat.size !== component.size) {
			throw new Error(`size mismatch for ${component.file}: catalog says ${component.size}, payload is ${payloadStat.size} bytes`);
		}
		const total = await directorySize(extensionDir);
		const budget = maxEmbeddedMb * 1024 * 1024;
		if (total > budget) {
			throw new Error(`embedded payload exceeds ${maxEmbeddedMb} MB (the extension ships ${Math.ceil(total / (1024 * 1024))} MB)`);
		}
	} else {
		const shipped = await readdir(extensionDir, { recursive: true });
		const leaked = shipped.filter(entry => entry.endsWith('.tar.gz'));
		if (leaked.length > 0) {
			throw new Error(`ondemand build contains a payload: ${leaked.join(', ')}`);
		}
	}
	console.log(`wsl component check passed (${flavor}, ${catalog.tag})`);
}

runCli(main);
