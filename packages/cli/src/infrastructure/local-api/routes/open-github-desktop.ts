/**
 * Local API — Open GitHub Desktop Route
 *
 * POST /api/open-github-desktop
 *
 * Opens a workspace directory in GitHub Desktop using the `github` CLI tool
 * that GitHub Desktop installs. Checks for CLI availability first.
 *
 * Request body (JSON): `{ workingDir: string }`
 * Response (JSON):
 *   - `{ success: true }` — command dispatched successfully
 *   - `{ success: false, error: "GitHub Desktop CLI not found" }` — CLI not installed
 *   - `{ success: false, error: string }` — validation failure or path error
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** JSON body sent by the caller. */
interface OpenGitHubDesktopBody {
  workingDir?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the platform-specific command used to locate an executable.
 * - POSIX: `which <name>`
 * - Windows: `where <name>`
 */
function resolveWhichCommand(name: string): string {
  return process.platform === 'win32' ? `where ${name}` : `which ${name}`;
}

/**
 * Check whether the `github` CLI command is available on PATH.
 * Resolves to true if found, false otherwise.
 */
function isGitHubCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(resolveWhichCommand('github'), (err) => {
      resolve(!err);
    });
  });
}

/**
 * Escape a filesystem path for safe use as a shell argument.
 * Wraps the path in double quotes and escapes any embedded double quotes.
 */
function escapeShellArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/open-github-desktop.
 */
async function handleOpenGitHubDesktop(req: LocalApiRequest): Promise<LocalApiResponse> {
  // Parse body
  let body: OpenGitHubDesktopBody = {};
  try {
    if (req.body) {
      body = JSON.parse(req.body) as OpenGitHubDesktopBody;
    }
  } catch {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    };
  }

  const { workingDir } = body;

  // Validate workingDir
  if (!workingDir || typeof workingDir !== 'string' || workingDir.trim() === '') {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'workingDir is required' }),
    };
  }

  // Verify the path exists before opening
  try {
    await access(workingDir);
  } catch {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: `Directory not found: ${workingDir}` }),
    };
  }

  // Check if `github` CLI is available
  const available = await isGitHubCliAvailable();
  if (!available) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'GitHub Desktop CLI not found' }),
    };
  }

  // Fire-and-forget: open GitHub Desktop
  const command = `github ${escapeShellArg(workingDir)}`;

  exec(command, (err) => {
    if (err) {
      // Log but don't propagate — response has already been sent
      console.warn(`[open-github-desktop] exec failed: ${err.message}`);
    }
  });

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
}

// ─── Route Definition ─────────────────────────────────────────────────────────

/**
 * Route registration entry for POST /api/open-github-desktop.
 * Import and pass to {@link LocalApiRouter.registerRoute} at server startup.
 */
export const openGitHubDesktopRoute: LocalApiRoute = {
  method: 'POST',
  path: '/api/open-github-desktop',
  handler: (req) => handleOpenGitHubDesktop(req),
};
