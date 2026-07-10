import { readFile } from 'node:fs/promises';
import path from 'node:path';

import ignore, { type Ignore } from 'ignore';

const IGNORE_FILES = ['.gitignore', '.cursorignore'] as const;

/** Load ignore rules from workspace root ignore files. Missing files are skipped. */
export async function loadWorkspaceIgnore(rootDir: string): Promise<Ignore> {
  const ig = ignore();
  for (const name of IGNORE_FILES) {
    try {
      const content = await readFile(path.join(rootDir, name), 'utf-8');
      ig.add(content);
    } catch {
      // file absent or unreadable — skip
    }
  }
  return ig;
}

/** Returns true if `relativePath` (forward-slash, repo-relative) is ignored. */
export function isPathIgnoredByRules(ig: Ignore, relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return ig.ignores(normalized);
}
