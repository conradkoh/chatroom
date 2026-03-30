/**
 * Local API CORS Middleware
 *
 * Adds CORS headers to every response from the local API server.
 * Since this server only listens on localhost, allowing all origins is safe —
 * only code running on the same machine can reach it.
 */

import type { LocalApiResponse } from './types.js';

// ─── CORS Headers ─────────────────────────────────────────────────────────────

/**
 * Standard CORS headers added to every local API response.
 * Permissive by design: the server only binds to 127.0.0.1, so there is no
 * cross-origin security risk in allowing all origins.
 *
 * Includes `Access-Control-Allow-Private-Network` for Chrome's Private Network
 * Access (PNA) policy, which blocks requests from public origins (e.g.
 * https://chatroom.duskfare.com) to loopback addresses unless the server
 * explicitly opts in via this header.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Apply CORS headers to a LocalApiResponse.
 * Merges CORS_HEADERS with any headers already set on the response.
 */
export function applyCorsHeaders(response: LocalApiResponse): LocalApiResponse {
  return {
    ...response,
    headers: {
      ...CORS_HEADERS,
      ...(response.headers ?? {}),
    },
  };
}

/**
 * Build a preflight response for HTTP OPTIONS requests.
 * Returns HTTP 204 No Content with all CORS headers set.
 */
export function buildPreflightResponse(): LocalApiResponse {
  return {
    status: 204,
    headers: CORS_HEADERS,
    body: '',
  };
}
