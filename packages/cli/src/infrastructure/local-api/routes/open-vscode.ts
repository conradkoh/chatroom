/**
 * Local API — Open VS Code Route
 *
 * POST /api/open-vscode
 *
 * Opens a workspace directory in Visual Studio Code using the `code` CLI tool.
 * Checks for CLI availability first.
 *
 * Install the `code` CLI via: VS Code → Cmd+Shift+P → "Shell Command: Install code in PATH"
 *
 * Request body (JSON): `{ workingDir: string }`
 * Response (JSON):
 *   - `{ success: true }` — command dispatched successfully
 *   - `{ success: false, error: "VS Code CLI (code) not found. Install via: ..." }` — CLI not installed
 *   - `{ success: false, error: string }` — validation failure or path error
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** JSON body sent by the caller. */
interface OpenVSCodeBody {
  workingDir?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Error message returned when the `code` CLI is not found on PATH.
 * Includes install instructions for discoverability.
 */
const CODE_CLI_NOT_FOUND =
  "VS Code CLI (code) not found. Install via: VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'";

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
 * Check whether the `code` CLI command is available on PATH.
 * Resolves to true if found, false otherwise.
 */
function isVSCodeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(resolveWhichCommand('code'), (err) => {
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
 * Handle POST /api/open-vscode.
 */
async function handleOpenVSCode(req: LocalApiRequest): Promise<LocalApiResponse> {
  // Parse body
  let body: OpenVSCodeBody = {};
  try {
    if (req.body) {
      body = JSON.parse(req.body) as OpenVSCodeBody;
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

  // Check if `code` CLI is available
  const available = await isVSCodeCliAvailable();
  if (!available) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: CODE_CLI_NOT_FOUND }),
    };
  }

  // Fire-and-forget: open VS Code
  const command = `code ${escapeShellArg(workingDir)}`;

  exec(command, (err) => {
    if (err) {
      // Log but don't propagate — response has already been sent
      console.warn(`[open-vscode] exec failed: ${err.message}`);
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
 * Route registration entry for POST /api/open-vscode.
 * Import and pass to {@link LocalApiRouter.registerRoute} at server startup.
 */
export const openVSCodeRoute: LocalApiRoute = {
  method: 'POST',
  path: '/api/open-vscode',
  handler: (req) => handleOpenVSCode(req),
};
