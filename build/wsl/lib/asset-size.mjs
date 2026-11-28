'use strict';

// asset-size.mjs — print the byte size of a release asset from a `curl -D` dump.
//
//   curl -sSfL -D /tmp/headers -o /dev/null <asset-url>
//   node build/wsl/lib/asset-size.mjs /tmp/headers
//
// Uses the last non-zero Content-Length because GitHub's first hop is a 302 with
// `Content-Length: 0` and only the CDN it redirects to knows the real size.

import { readFileSync } from 'node:fs';
import { assetSizeFromHeaders } from './common.mjs';

const path = process.argv[2];
if (!path) {
	console.error('usage: asset-size.mjs <header-dump>');
	process.exit(2);
}

const size = assetSizeFromHeaders(readFileSync(path, 'utf8'));
if (size === 0) {
	console.error(`${path} carries no Content-Length for the asset`);
	process.exit(1);
}
console.log(size);
