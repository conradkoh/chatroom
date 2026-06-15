/**
 * Local Action Executor
 *
 * Shared module for executing local actions (open-vscode, open-finder, open-github-desktop, git operations).
 * Used by the daemon command loop to process Convex-relayed actions.
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { LocalActionType } from '@workspace/backend/config/localActions.js';

import {
  discardFile as gitDiscardFile,
  discardAllChanges as gitDiscardAll,
  gitPull,
  gitPush,
  gitSync,
} from '../git/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Re-export from the canonical backend config definition. */
export type { LocalActionType };

/** Result of executing a local action. */
export type LocalActionResult =
  | { success: true }
  | { success: true; message: string }
  | { success: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape a filesystem path for safe use as a shell argument.
 * Wraps the path in double quotes and escapes any embedded double quotes.
 */
function escapeShellArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the platform-specific command used to locate an executable.
 * - POSIX: `which <name>`
 * - Windows: `where <name>`
 */
function resolveWhichCommand(name: string): string {
  return process.platform === 'win32' ? `where ${name}` : `which ${name}`;
}

/**
 * Check whether a CLI command is available on PATH.
 * Resolves to `true` if found, `false` otherwise.
 */
function isCliAvailable(cliName: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(resolveWhichCommand(cliName), (err) => {
      resolve(!err);
    });
  });
}

/**
 * Fire-and-forget: execute a shell command and log errors without propagating.
 */
function execFireAndForget(command: string, logTag: string): void {
  exec(command, (err) => {
    if (err) {
      console.warn(`[${logTag}] exec failed: ${err.message}`);
    }
  });
}

/**
 * Resolve the platform-specific command used to open a folder in the file explorer.
 */
function resolveOpenCommand(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'explorer';
    default:
      return 'xdg-open';
  }
}

// ─── Executor ─────────────────────────────────────────────────────────────────

async function openVscode(workingDir: string): Promise<LocalActionResult> {
  const available = await isCliAvailable('code');
  if (!available) {
    return {
      success: false,
      error:
        "VS Code CLI (code) not found. Install via: VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'",
    };
  }
  execFireAndForget(`code ${escapeShellArg(workingDir)}`, 'open-vscode');
  return { success: true };
}

async function openFinder(workingDir: string): Promise<LocalActionResult> {
  const cmd = resolveOpenCommand(process.platform);
  execFireAndForget(`${cmd} ${escapeShellArg(workingDir)}`, 'open-finder');
  return { success: true };
}

async function openGithubDesktop(workingDir: string): Promise<LocalActionResult> {
  const available = await isCliAvailable('github');
  if (!available) {
    return { success: false, error: 'GitHub Desktop CLI not found' };
  }
  execFireAndForget(`github ${escapeShellArg(workingDir)}`, 'open-github-desktop');
  return { success: true };
}

async function gitDiscardFileAction(workingDir: string): Promise<LocalActionResult> {
  const separatorIndex = workingDir.indexOf('::');
  if (separatorIndex === -1) {
    return {
      success: false,
      error: 'Invalid file path. Expected format: "/path/to/dir::/path/to/file"',
    };
  }
  const dir = workingDir.slice(0, separatorIndex);
  const filePath = workingDir.slice(separatorIndex + 2);
  const result = await gitDiscardFile(dir, filePath);
  if (result.status === 'error') {
    return { success: false, error: result.message };
  }
  return { success: true };
}

async function gitDiscardAllAction(workingDir: string): Promise<LocalActionResult> {
  const result = await gitDiscardAll(workingDir);
  if (result.status === 'error') {
    return { success: false, error: result.message };
  }
  return { success: true };
}

async function gitPullAction(workingDir: string): Promise<LocalActionResult> {
  const result = await gitPull(workingDir);
  if (result.status === 'error') {
    return { success: false, error: result.message };
  }
  return { success: true, message: result.message ?? 'Pull successful' };
}

async function gitPushAction(workingDir: string): Promise<LocalActionResult> {
  const result = await gitPush(workingDir);
  if (result.status === 'error') {
    return { success: false, error: result.message };
  }
  return { success: true, message: result.message ?? 'Push successful' };
}

async function gitSyncAction(workingDir: string): Promise<LocalActionResult> {
  const result = await gitSync(workingDir);
  if (result.status === 'error') {
    return { success: false, error: result.message };
  }
  return { success: true, message: result.message ?? 'Sync successful' };
}

/**
 * Execute a local action for the given working directory.
 *
 * Validates the directory exists, checks CLI availability where needed,
 * and fires the appropriate shell command.
 */
const actionHandlers: Record<string, (dir: string) => Promise<LocalActionResult>> = {
  'open-vscode': openVscode,
  'open-finder': openFinder,
  'open-github-desktop': openGithubDesktop,
  'git-discard-file': gitDiscardFileAction,
  'git-discard-all': gitDiscardAllAction,
  'git-pull': gitPullAction,
  'git-push': gitPushAction,
  'git-sync': gitSyncAction,
};

export async function executeLocalAction(
  action: LocalActionType,
  workingDir: string
): Promise<LocalActionResult> {
  try {
    await access(workingDir);
  } catch {
    return { success: false, error: `Directory not found: ${workingDir}` };
  }

  const handler = actionHandlers[action];
  if (handler) return handler(workingDir);

  return { success: false, error: `Unknown action: ${action}` };
}
