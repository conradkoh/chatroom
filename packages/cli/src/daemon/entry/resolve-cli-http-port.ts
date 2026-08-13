import { isProductionConvexUrl } from '@workspace/backend/prompts/utils/env.js';

import { getConvexUrl } from '../../infrastructure/convex/client.js';

/** Production daemon CLI HTTP port (local-web UI is 18765). */
// fallow-ignore-next-line unused-export
export const PRODUCTION_CLI_HTTP_PORT = 18766;

/** Non-production daemon CLI HTTP port (avoids conflict with prod daemon on same machine). */
// fallow-ignore-next-line unused-export
export const NON_PRODUCTION_CLI_HTTP_PORT = 28766;

/**
 * Resolve the default CLI HTTP port from the daemon's Convex environment.
 * `CHATROOM_CLI_HTTP_PORT` override is handled by the caller.
 */
// fallow-ignore-next-line unused-export
export function resolveDefaultCliHttpPort(convexUrl = getConvexUrl()): number {
  return isProductionConvexUrl(convexUrl) ? PRODUCTION_CLI_HTTP_PORT : NON_PRODUCTION_CLI_HTTP_PORT;
}

/**
 * Resolve the CLI HTTP port: explicit env override wins, else environment-based default.
 */
export function resolveCliHttpPort(
  env: NodeJS.ProcessEnv = process.env,
  convexUrl = getConvexUrl()
): number {
  const override = env.CHATROOM_CLI_HTTP_PORT;
  if (override !== undefined && override !== '') {
    return Number(override);
  }
  return resolveDefaultCliHttpPort(convexUrl);
}
