'use strict';

// Shared helpers for the WSL packaging scripts (assemble / check / offline-bundle).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
// The gate compares versions with the same code the client selects with, so a
// payload that passes packaging cannot be refused at runtime by a tie-break.
import { compareVersions, parseVersion } from '../../../vscode/extensions/picket-remote-wsl/src/version.js';

/**
 * The canonical name of the server payload for a server version.
 * @param {string} version
 */
export function payloadName(version) {
	return `picket-code-server-${version}-linux-x64.tar.gz`;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isSemver(text) {
	return parseVersion(text) !== undefined;
}

/**
 * @param {string} text @param {string} label how the value reached the script
 * @returns {string}
 */
export function requireSemver(text, label) {
	if (!isSemver(text)) {
		throw new Error(`${label} must be a semver x.y.z (got "${text}")`);
	}
	return text;
}

export { compareVersions };

/**
 * Parse an SHA256SUMS file into a Map of file name -> digest. Tolerates the
 * binary-mode `*` marker and CRLF endings.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseSha256Sums(text) {
	/** @type {Map<string, string>} */
	const sums = new Map();
	for (const line of text.split('\n')) {
		const match = /^([0-9a-f]{64})[ \t]+\*?(.+?)[ \t\r]*$/.exec(line);
		if (match) {
			sums.set(match[2], match[1]);
		}
	}
	return sums;
}

/**
 * @param {string} path
 * @returns {Promise<Map<string, string>>}
 */
export async function readSha256Sums(path) {
	return parseSha256Sums(await readFile(path, 'utf8'));
}

/**
 * The catalog component that ships `file`, if any.
 * @param {{ components?: Array<{ file?: string }> }} catalog
 * @param {string} file
 */
export function componentFor(catalog, file) {
	return (catalog.components ?? []).find(component => component.file === file);
}

/**
 * SHA-256 of a file, streamed so an 80 MB payload never sits in memory.
 * @param {string} path
 */
export async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) {
		hash.update(/** @type {Buffer} */ (chunk));
	}
	return hash.digest('hex');
}

/**
 * Byte size of a release asset, read from a `curl -D` header dump.
 *
 * GitHub answers `github.com/…/releases/download/…` with a 302 whose own
 * `Content-Length` is 0 and defers the real size to the CDN host it redirects
 * to, so the **last** `Content-Length` header is the only useful one.
 * @param {string} headers
 * @returns {number} the size, or 0 when no header carried a non-zero value
 */
export function assetSizeFromHeaders(headers) {
	let size = 0;
	for (const line of headers.split('\n')) {
		const match = /^content-length:\s*(\d+)\s*$/i.exec(line.trim());
		if (match) {
			const value = Number(match[1]);
			if (value > 0) {
				size = value;
			}
		}
	}
	return size;
}

/**
 * Minimal `--key value` reader for the packaging CLIs.
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag.startsWith('--')) {
			args[flag.slice(2)] = argv[index + 1] ?? '';
		}
	}
	return args;
}

/**
 * @param {Record<string, string>} args
 * @param {string} key
 */
export function requireArg(args, key) {
	const value = args[key];
	if (!value) {
		throw new Error(`--${key} is required`);
	}
	return value;
}

/**
 * Run a CLI main and turn failures into a stderr message plus exit code 1.
 * @param {() => Promise<void>} main
 */
export function runCli(main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
