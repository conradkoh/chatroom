/**
 * Git write operations (modifying the working tree).
 *
 * All functions return discriminated unions — no throws.
 * Errors from git (non-zero exit) or missing git installation are
 * captured and returned as `{ status: 'error' }`.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitDiscardResult, GitPullResult } from './types.js';

const execAsync = promisify(exec);

/**
 * Run a git command in `cwd`.
 * Returns `{ stdout, stderr }` on success, `{ error }` on failure.
 * Never throws.
 */
async function runGit(
  args: string,
  cwd: string
): Promise<{ stdout: string; stderr: string } | { error: Error & { code?: number } }> {
  try {
    const result = await execAsync(`git ${args}`, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      timeout: 30_000, // 30s timeout for destructive operations
    });
    return result;
  } catch (err) {
    return { error: err as Error & { code?: number } };
  }
}

/**
 * Classify a git error into a structured result.
 */
function classifyError(errMessage: string): { status: 'error'; message: string } {
  return { status: 'error', message: errMessage.trim() };
}

/**
 * Discard changes to a specific file.
 *
 * Uses `git checkout -- <file>` to restore the file to HEAD.
 *
 * Returns `{ status: 'available' }` on success.
 * Returns `{ status: 'error', message }` on failure.
 */
export async function discardFile(workingDir: string, filePath: string): Promise<GitDiscardResult> {
  const result = await runGit(`checkout -- ${filePath}`, workingDir);

  if ('error' in result) {
    return classifyError(result.error.message);
  }

  return { status: 'available' };
}

/**
 * Discard all changes in the working tree.
 *
 * Uses `git checkout -- .` to restore all tracked files to HEAD,
 * then `git clean -fd` to remove untracked files.
 *
 * Returns `{ status: 'available' }` on success.
 * Returns `{ status: 'error', message }` on failure.
 *
 * Note: This will permanently delete untracked files!
 */
export async function discardAllChanges(workingDir: string): Promise<GitDiscardResult> {
  // First, checkout all tracked files
  const checkoutResult = await runGit('checkout -- .', workingDir);
  if ('error' in checkoutResult) {
    return classifyError(checkoutResult.error.message);
  }

  // Then, clean untracked files and directories
  const cleanResult = await runGit('clean -fd', workingDir);
  if ('error' in cleanResult) {
    return classifyError(cleanResult.error.message);
  }

  return { status: 'available' };
}

/**
 * Discard staged changes (unstage all).
 *
 * Uses `git reset HEAD` to unstage all staged changes.
 *
 * Returns `{ status: 'available' }` on success.
 * Returns `{ status: 'error', message }` on failure.
 */
export async function discardStaged(workingDir: string): Promise<GitDiscardResult> {
  const result = await runGit('reset HEAD', workingDir);

  if ('error' in result) {
    return classifyError(result.error.message);
  }

  return { status: 'available' };
}

/**
 * Perform a git pull from the default remote.
 *
 * Uses `git pull` to fetch and merge from the tracking branch.
 *
 * Returns `{ status: 'available' }` on success.
 * Returns `{ status: 'error', message }` on failure.
 */
export async function gitPull(workingDir: string): Promise<GitPullResult> {
  const result = await runGit('pull', workingDir);

  if ('error' in result) {
    const message = result.error.message;
    // Check for common specific errors to provide better messages
    if (message.includes('no tracking branch')) {
      return {
        status: 'error',
        message: 'No tracking branch configured. Set upstream with `git push -u`.',
      };
    }
    if (message.includes('conflict')) {
      return { status: 'error', message: 'Merge conflict detected. Resolve conflicts manually.' };
    }
    if (message.includes('Authentication failed') || message.includes('could not read')) {
      return {
        status: 'error',
        message: 'Authentication failed. Run `gh auth status` to check your GitHub credentials.',
      };
    }
    return classifyError(message);
  }

  // Check stderr for non-fatal warnings (like "Already up to date.")
  const stderr = result.stderr.trim();
  if (stderr && !stderr.includes('Already up to date')) {
    // Pull succeeded but with warnings - still available
    return { status: 'available', message: stderr };
  }

  return { status: 'available' };
}
