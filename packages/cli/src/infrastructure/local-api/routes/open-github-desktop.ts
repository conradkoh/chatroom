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

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';
import {
  parseWorkingDir,
  escapeShellArg,
  isCliAvailable,
  execFireAndForget,
  jsonResponse,
} from './shared-utils.js';

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/open-github-desktop.
 */
async function handleOpenGitHubDesktop(req: LocalApiRequest): Promise<LocalApiResponse> {
  const parsed = await parseWorkingDir(req);
  if (!parsed.ok) return parsed.response;

  // Check if `github` CLI is available
  const available = await isCliAvailable('github');
  if (!available) {
    return jsonResponse(200, { success: false, error: 'GitHub Desktop CLI not found' });
  }

  // Fire-and-forget: open GitHub Desktop
  execFireAndForget(`github ${escapeShellArg(parsed.workingDir)}`, 'open-github-desktop');

  return jsonResponse(200, { success: true });
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
