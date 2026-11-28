'use strict';

// Verifies that a built app's WSL component is self-consistent before it is
// packaged: the catalog is schema 2, it offers a server built from this
// client's commit at or above the stamped minimum, the resolver proposal is
// enabled, embedded payloads are present with the right bytes, and ondemand
// builds carry no payload at all. Run in packaging, never in the extension.
//
//   node check.mjs --app <app> --flavor embedded --max-embedded-mb 110

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { compareVersions, isSemver, parseArgs, payloadName, requireArg, runCli, sha256File } from './lib/common.mjs';

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

/**
 * The component this app should run: same commit, at or above the minimum.
 * Every failure names the value that is wrong, because the fix is always a
 * build variable and never something the reader can guess.
 * @param {{ schema?: number, minVersion?: string, components?: Array<{ commit?: string, version?: string, file?: string }> }} catalog
 * @param {{ commit?: string, picketServerMinVersion?: string }} product
 */
function selectForClient(catalog, product) {
	if (catalog.schema !== 2) {
		throw new Error(`catalog schema ${catalog.schema ?? '(missing)'} is not 2: re-run assemble.mjs`);
	}
	const min = product.picketServerMinVersion;
	if (!min) {
		throw new Error('product.json picketServerMinVersion is missing: assemble.mjs did not stamp this app');
	}
	if (catalog.minVersion !== min) {
		throw new Error(`catalog minVersion ${catalog.minVersion ?? '(missing)'} does not match picketServerMinVersion ${min}`);
	}
	if (!product.commit) {
		throw new Error('product.json commit is missing: the catalog cannot be matched to this build');
	}
	const components = Array.isArray(catalog.components) ? catalog.components : [];
	for (const component of components) {
		if (!isSemver(String(component.version))) {
			throw new Error(`${component.file ?? component.version} version "${component.version}" is not a semver version`);
		}
	}
	const ours = components.filter(component => component.commit === product.commit);
	if (ours.length === 0) {
		const commits = [...new Set(components.map(component => component.commit))].join(', ') || 'none';
		throw new Error(`no server component for commit ${product.commit} (catalog has: ${commits})`);
	}
	const usable = ours.filter(component => compareVersions(String(component.version), min) >= 0);
	if (usable.length === 0) {
		const best = ours.reduce((top, component) => (compareVersions(String(component.version), String(top.version)) > 0 ? component : top));
		throw new Error(`catalog offers ${best.version}, requires >= ${min}`);
	}
	return usable.reduce((top, component) => (compareVersions(String(component.version), String(top.version)) > 0 ? component : top));
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
	const component = selectForClient(catalog, product);
	const name = payloadName(component.version);
	if (component.file !== name) {
		throw new Error(`component file ${component.file} does not match its version (expected ${name})`);
	}
	if (catalog.flavor !== flavor) {
		throw new Error(`catalog flavor ${catalog.flavor} does not match --flavor ${flavor}`);
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
	console.log(`wsl component check passed (${flavor}, server ${component.version} >= ${product.picketServerMinVersion}, commit ${product.commit})`);
}

runCli(main);
