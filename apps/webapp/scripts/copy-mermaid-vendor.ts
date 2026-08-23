#!/usr/bin/env bun

/**
 * Copies the prebundled mermaid UMD bundle into public/ for static serving.
 * Avoids runtime node_modules reads in serverless (Vercel NFT does not trace mermaid.min.js).
 *
 * Usage: bun scripts/copy-mermaid-vendor.ts
 * Output: public/vendor/mermaid.min.js (gitignored)
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webappRoot = join(__dirname, '..');
const require = createRequire(join(webappRoot, 'package.json'));

const source = require.resolve('mermaid/dist/mermaid.min.js');
const dest = join(webappRoot, 'public/vendor/mermaid.min.js');

await mkdir(dirname(dest), { recursive: true });
await copyFile(source, dest);
console.log(`Copied mermaid.min.js → public/vendor/mermaid.min.js`);
