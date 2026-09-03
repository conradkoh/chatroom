import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { runGit } from './run-command.js';

export type CloneRepositoryResult =
  { success: true; workingDir: string; cloned: boolean } | { success: false; error: string };

/** Clone a repository unless the target already exists as a git repository. */
// Clone, reuse, and filesystem failure outcomes are explicit by design.
// fallow-ignore-next-line complexity
export async function cloneRepositoryIfNeeded(
  cloneUrl: string,
  targetWorkingDir: string
): Promise<CloneRepositoryResult> {
  try {
    if (existsSync(targetWorkingDir)) {
      const gitDir = await runGit(['rev-parse', '--git-dir'], targetWorkingDir, { readOnly: true });
      if ('error' in gitDir) {
        return { success: false, error: 'Folder already exists and is not a git repository' };
      }
      return { success: true, workingDir: targetWorkingDir, cloned: false };
    }

    const parentDir = path.dirname(targetWorkingDir);
    const dirName = path.basename(targetWorkingDir);
    await mkdir(parentDir, { recursive: true });

    const result = await runGit(['clone', cloneUrl, dirName], parentDir, { timeout: 5 * 60_000 });
    if ('error' in result) return { success: false, error: result.error.message };
    return { success: true, workingDir: targetWorkingDir, cloned: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
