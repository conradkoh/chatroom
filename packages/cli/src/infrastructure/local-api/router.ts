/**
 * Local API Router
 *
 * Minimal route registry and request dispatcher for the local daemon HTTP server.
 * Routes are registered once at startup; requests are matched by method + path.
 */

import { applyCorsHeaders, buildPreflightResponse } from './cors.js';
import type { DaemonContext, LocalApiRequest, LocalApiResponse, LocalApiRoute } from './types.js';

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Simple route registry and dispatcher.
 * Routes are matched in registration order; first match wins.
 */
export class LocalApiRouter {
  private readonly routes: LocalApiRoute[] = [];

  /**
   * Register a route with the router.
   * Routes are matched by exact method + path comparison.
   */
  registerRoute(route: LocalApiRoute): void {
    this.routes.push(route);
  }

  /**
   * Dispatch an incoming request to the matching route handler.
   *
   * - OPTIONS requests are handled automatically with a CORS preflight response.
   * - Unmatched routes return HTTP 404.
   * - CORS headers are applied to all responses.
   */
  async handleRequest(req: LocalApiRequest, ctx: DaemonContext): Promise<LocalApiResponse> {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return buildPreflightResponse();
    }

    // Find a matching route (strip query string for path matching)
    const pathname = req.url.split('?')[0] ?? req.url;
    const route = this.routes.find(
      (r) => r.method === req.method && r.path === pathname
    );

    let response: LocalApiResponse;

    if (route) {
      try {
        response = await route.handler(req, ctx);
      } catch (error) {
        response = {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Internal server error' }),
        };
      }
    } else {
      response = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Not found' }),
      };
    }

    return applyCorsHeaders(response);
  }
}
