/**
 * Local API — Open Finder Route
 *
 * POST /api/open-finder
 *
 * Opens a workspace directory in the OS file explorer:
 *   - macOS:   `open <workingDir>`
 *   - Linux:   `xdg-open <workingDir>`
 *   - Windows: `explorer <workingDir>`
 *
 * The command is fire-and-forget — the route returns as soon as the process is
 * spawned, without waiting for the file explorer to close.
 *
 * Request body (JSON): `{ workingDir: string }`
 * Response (JSON):
 *   - `{ success: true }` — command dispatched successfully
 *   - `{ success: false, error: string }` — validation failure or path error
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** JSON body sent by the caller. */
interface OpenFinderBody {
  workingDir?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
      // Linux and other Unix-like systems
      return 'xdg-open';
  }
}

/**
 * Escape a filesystem path for safe use as a shell argument.
 * Wraps the path in double quotes and escapes any embedded double quotes.
 */
function escapeShellArg(arg: string): string {
  // Replace any embedded double-quote with \"
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/open-finder.
 */
async function handleOpenFinder(req: LocalApiRequest): Promise<LocalApiResponse> {
  // Parse body
  let body: OpenFinderBody = {};
  try {
    if (req.body) {
      body = JSON.parse(req.body) as OpenFinderBody;
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

  // Fire-and-forget: spawn the file explorer
  const cmd = resolveOpenCommand(process.platform);
  const command = `${cmd} ${escapeShellArg(workingDir)}`;

  exec(command, (err) => {
    if (err) {
      // Log but don't propagate — the response has already been sent
      console.warn(`[open-finder] exec failed: ${err.message}`);
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
 * Route registration entry for POST /api/open-finder.
 * Import and pass to {@link LocalApiRouter.registerRoute} at server startup.
 */
export const openFinderRoute: LocalApiRoute = {
  method: 'POST',
  path: '/api/open-finder',
  handler: (req) => handleOpenFinder(req),
};
