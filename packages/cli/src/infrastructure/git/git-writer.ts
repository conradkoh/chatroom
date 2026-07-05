/**
 * Git write operations (modifying the working tree).
 *
 * All functions return discriminated unions — no throws.
 * Errors from git (non-zero exit) or missing git installation are
 * captured and returned as `{ status: 'error' }`.
 */

import { runGit } from './run-command.js';
import type { GitDiscardResult, GitPullResult, GitPushResult } from './types.js';

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
  const result = await runGit(['checkout', '--', filePath], workingDir);

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
  const checkoutResult = await runGit(['checkout', '--', '.'], workingDir);
  if ('error' in checkoutResult) {
    return classifyError(checkoutResult.error.message);
  }

  const cleanResult = await runGit(['clean', '-fd'], workingDir);
  if ('error' in cleanResult) {
    return classifyError(cleanResult.error.message);
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
  const result = await runGit(['pull'], workingDir);

  if ('error' in result) {
    const message = result.error.message;
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

  const stderr = result.stderr.trim();
  if (stderr && !stderr.includes('Already up to date')) {
    return { status: 'available', message: stderr };
  }

  return { status: 'available' };
}

/**
 * Perform a git push to the upstream tracking branch.
 */
export async function gitPush(workingDir: string): Promise<GitPushResult> {
  const result = await runGit(['push'], workingDir);

  if ('error' in result) {
    const message = result.error.message;
    if (message.includes('no upstream branch')) {
      return {
        status: 'error',
        message: 'No upstream branch configured. Set upstream with `git push -u`.',
      };
    }
    if (message.includes('Authentication failed') || message.includes('could not read')) {
      return {
        status: 'error',
        message: 'Authentication failed. Run `gh auth status` to check your GitHub credentials.',
      };
    }
    return classifyError(message);
  }

  const stderr = result.stderr.trim();
  if (stderr && !stderr.includes('Everything up-to-date')) {
    return { status: 'available', message: stderr };
  }

  return { status: 'available' };
}

/**
 * Pull then push — sync local branch with upstream.
 */
export async function gitSync(workingDir: string): Promise<GitPushResult> {
  const pullResult = await gitPull(workingDir);
  if (pullResult.status === 'error') {
    return pullResult;
  }
  return gitPush(workingDir);
}
