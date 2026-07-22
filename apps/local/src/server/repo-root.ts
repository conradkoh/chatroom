import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRepoRoot(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not find repo root (pnpm-workspace.yaml)');
    dir = parent;
  }
}
