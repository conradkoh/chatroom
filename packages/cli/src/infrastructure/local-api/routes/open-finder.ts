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

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';
import {
  parseWorkingDir,
  escapeShellArg,
  execFireAndForget,
  jsonResponse,
} from './shared-utils.js';

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

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/open-finder.
 */
async function handleOpenFinder(req: LocalApiRequest): Promise<LocalApiResponse> {
  const parsed = await parseWorkingDir(req);
  if (!parsed.ok) return parsed.response;

  // Fire-and-forget: spawn the file explorer
  const cmd = resolveOpenCommand(process.platform);
  execFireAndForget(`${cmd} ${escapeShellArg(parsed.workingDir)}`, 'open-finder');

  return jsonResponse(200, { success: true });
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
