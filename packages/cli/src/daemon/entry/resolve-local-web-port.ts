import { isProductionConvexUrl } from '@workspace/backend/prompts/utils/env.js';

import { getConvexUrl } from '../../infrastructure/convex/client.js';

/** Production daemon local-web UI port. */
// fallow-ignore-next-line unused-export
export const PRODUCTION_LOCAL_WEB_PORT = 18765;

/** Non-production daemon local-web UI port (avoids conflict with prod daemon on same machine). */
// fallow-ignore-next-line unused-export
export const NON_PRODUCTION_LOCAL_WEB_PORT = 28765;

/**
 * Resolve the default local-web port from the daemon's Convex environment.
 * `CHATROOM_LOCAL_WEB_PORT` override is handled by the caller.
 */
// fallow-ignore-next-line unused-export
export function resolveDefaultLocalWebPort(convexUrl = getConvexUrl()): number {
  return isProductionConvexUrl(convexUrl)
    ? PRODUCTION_LOCAL_WEB_PORT
    : NON_PRODUCTION_LOCAL_WEB_PORT;
}

/**
 * Resolve the local-web port: explicit env override wins, else environment-based default.
 */
export function resolveLocalWebPort(
  env: NodeJS.ProcessEnv = process.env,
  convexUrl = getConvexUrl()
): number {
  const override = env.CHATROOM_LOCAL_WEB_PORT;
  if (override !== undefined && override !== '') {
    return Number(override);
  }
  return resolveDefaultLocalWebPort(convexUrl);
}
