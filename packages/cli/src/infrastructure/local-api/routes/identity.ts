/**
 * Local API — Identity Route
 *
 * GET /api/identity
 *
 * Returns machine identity information so the webapp can detect whether it is
 * running on the same machine as the daemon.  The response includes:
 *   - machineId  — stable UUID unique to this machine + Convex endpoint
 *   - hostname   — machine hostname
 *   - os         — operating system (darwin | linux | win32 | …)
 *   - version    — CLI version from package.json
 */

import { getVersion } from '../../../version.js';
import type { LocalApiRequest, LocalApiResponse, LocalApiRoute, DaemonContext } from '../types.js';

// ─── Response Shape ──────────────────────────────────────────────────────────

/**
 * JSON body returned by GET /api/identity.
 */
export interface IdentityResponse {
  machineId: string;
  hostname: string;
  os: string;
  version: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handle GET /api/identity.
 * Reads machine info from the daemon context and returns it as JSON.
 */
async function handleIdentity(
  _req: LocalApiRequest,
  ctx: DaemonContext
): Promise<LocalApiResponse> {
  const identity: IdentityResponse = {
    machineId: ctx.machineId,
    hostname: ctx.config?.hostname ?? 'unknown',
    os: ctx.config?.os ?? 'unknown',
    version: getVersion(),
  };

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identity),
  };
}

// ─── Route Definition ─────────────────────────────────────────────────────────

/**
 * Route registration entry for GET /api/identity.
 * Import and pass to {@link LocalApiRouter.registerRoute} at server startup.
 */
export const identityRoute: LocalApiRoute = {
  method: 'GET',
  path: '/api/identity',
  handler: handleIdentity,
};
