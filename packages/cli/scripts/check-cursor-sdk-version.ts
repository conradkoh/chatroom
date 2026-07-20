#!/usr/bin/env bun
/**
 * Compares the exact @cursor/sdk pin in package.json against npm's latest version.
 * Exit 0 when up to date; exit 1 when a newer version is available.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const pinned = pkg.dependencies?.['@cursor/sdk'];

if (!pinned) {
  console.error('Missing @cursor/sdk dependency in packages/cli/package.json');
  process.exit(1);
}

const response = await fetch('https://registry.npmjs.org/@cursor/sdk/latest');
if (!response.ok) {
  console.error(`Failed to fetch npm registry: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const { version: latest } = (await response.json()) as { version: string };

if (pinned === latest) {
  console.log(`@cursor/sdk is up to date (${pinned})`);
  process.exit(0);
}

console.error(`@cursor/sdk is pinned to ${pinned} but npm latest is ${latest}`);
console.error(
  'Bump packages/cli/package.json, pnpm install, and update cursor-sdk-package.test.ts'
);
process.exit(1);
