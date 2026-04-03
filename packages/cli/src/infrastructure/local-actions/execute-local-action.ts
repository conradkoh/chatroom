/**
 * Local Action Executor
 *
 * Shared module for executing local actions (open-vscode, open-finder, open-github-desktop).
 * Used by both:
 * - The local HTTP API routes (for direct localhost calls from Chrome)
 * - The daemon command loop (for Convex-relayed actions from Safari/all browsers)
 */

import { access } from 'node:fs/promises';

import {
  escapeShellArg,
  isCliAvailable,
  execFireAndForget,
} from '../local-api/routes/shared-utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

import type { LocalActionType } from '@workspace/backend/config/localActions.js';

/** Re-export from the canonical backend config definition. */
export type { LocalActionType };

/** Result of executing a local action. */
export type LocalActionResult =
  | { success: true }
  | { success: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Execute a local action for the given working directory.
 *
 * Validates the directory exists, checks CLI availability where needed,
 * and fires the appropriate shell command.
 *
 * @param action     - The action to execute
 * @param workingDir - Absolute path to the working directory
 * @returns Result indicating success or failure with an error message
 */
export async function executeLocalAction(
  action: LocalActionType,
  workingDir: string
): Promise<LocalActionResult> {
  // Validate directory exists
  try {
    await access(workingDir);
  } catch {
    return { success: false, error: `Directory not found: ${workingDir}` };
  }

  switch (action) {
    case 'open-vscode': {
      const available = await isCliAvailable('code');
      if (!available) {
        return {
          success: false,
          error: "VS Code CLI (code) not found. Install via: VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'",
        };
      }
      execFireAndForget(`code ${escapeShellArg(workingDir)}`, 'open-vscode');
      return { success: true };
    }

    case 'open-finder': {
      const cmd = resolveOpenCommand(process.platform);
      execFireAndForget(`${cmd} ${escapeShellArg(workingDir)}`, 'open-finder');
      return { success: true };
    }

    case 'open-github-desktop': {
      const available = await isCliAvailable('github');
      if (!available) {
        return { success: false, error: 'GitHub Desktop CLI not found' };
      }
      execFireAndForget(`github ${escapeShellArg(workingDir)}`, 'open-github-desktop');
      return { success: true };
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = action;
      return { success: false, error: `Unknown action: ${_exhaustive}` };
    }
  }
}
