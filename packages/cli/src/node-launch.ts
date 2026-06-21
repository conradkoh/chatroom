#!/usr/bin/env node
/**
 * Re-exec chatroom with Node flags required by @cursor/sdk@1.0.19+.
 *
 * NODE_OPTIONS must be set before the Node process starts; the SDK imports
 * `node:sqlite` at module load time, which requires --experimental-sqlite on
 * current Node releases.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = join(dirname(fileURLToPath(import.meta.url)), 'index.js');
const nodeOptions = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(Boolean);
if (!nodeOptions.some((opt) => opt.includes('experimental-sqlite'))) {
  nodeOptions.push('--experimental-sqlite');
}

const result = spawnSync(process.execPath, [main, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions.join(' ') },
});

if (result.signal) {
  process.exit(1);
}
process.exit(result.status ?? 1);
