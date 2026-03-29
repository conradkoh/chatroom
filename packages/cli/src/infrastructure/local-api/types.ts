/**
 * Local API Types
 *
 * Type definitions for the lightweight HTTP server that allows the webapp
 * to detect and communicate with a daemon running on the same machine.
 */

import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { DaemonContext };

// ─── Request / Response ──────────────────────────────────────────────────────

/**
 * Normalized HTTP request passed to route handlers.
 */
export interface LocalApiRequest {
  /** HTTP method (uppercase) */
  method: string;
  /** Full request URL (e.g. "/api/identity") */
  url: string;
  /** Request headers as a plain string record */
  headers: Record<string, string>;
  /** Raw request body, if any */
  body?: string;
}

/**
 * Normalized HTTP response returned by route handlers.
 */
export interface LocalApiResponse {
  /** HTTP status code */
  status: number;
  /** Optional response headers */
  headers?: Record<string, string>;
  /** Response body (JSON string recommended) */
  body: string;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * A single route registered with the local API router.
 * Each route declares the HTTP method, path, and handler function.
 */
export interface LocalApiRoute {
  /** HTTP method this route responds to */
  method: 'GET' | 'POST';
  /** Exact path this route matches (e.g. "/api/identity") */
  path: string;
  /**
   * Handler function called when the route is matched.
   * Receives the normalized request and the current daemon context.
   */
  handler: (req: LocalApiRequest, ctx: DaemonContext) => Promise<LocalApiResponse>;
}
