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

import type { LocalApiRequest, LocalApiResponse, LocalApiRoute } from '../types.js';
import {
  parseWorkingDir,
  escapeShellArg,
  isCliAvailable,
  execFireAndForget,
  jsonResponse,
} from './shared-utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Error message returned when the `code` CLI is not found on PATH.
 * Includes install instructions for discoverability.
 */
const CODE_CLI_NOT_FOUND =
  "VS Code CLI (code) not found. Install via: VS Code → Cmd+Shift+P → 'Shell Command: Install code in PATH'";

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle POST /api/open-vscode.
 */
async function handleOpenVSCode(req: LocalApiRequest): Promise<LocalApiResponse> {
  const parsed = await parseWorkingDir(req);
  if (!parsed.ok) return parsed.response;

  // Check if `code` CLI is available
  const available = await isCliAvailable('code');
  if (!available) {
    return jsonResponse(200, { success: false, error: CODE_CLI_NOT_FOUND });
  }

  // Fire-and-forget: open VS Code
  execFireAndForget(`code ${escapeShellArg(parsed.workingDir)}`, 'open-vscode');

  return jsonResponse(200, { success: true });
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
