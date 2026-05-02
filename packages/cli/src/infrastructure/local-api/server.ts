/**
 * Local API Server
 *
 * Lightweight HTTP server bound to 127.0.0.1 that exposes the local daemon API.
 * The webapp uses this to detect whether it is running on the same machine as the
 * daemon and to access local capabilities (e.g. identity, future editor integration).
 *
 * The server:
 * - Binds only to localhost (not exposed to the network)
 * - Registers all known routes on startup
 * - Handles port conflicts gracefully (warns and continues)
 * - Returns a stop handle for clean shutdown
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { LocalApiRouter } from './router.js';
import type { NodeError } from '../types/node-error.js';
import { identityRoute } from './routes/identity.js';
import { openFinderRoute } from './routes/open-finder.js';
import { openGitHubDesktopRoute } from './routes/open-github-desktop.js';
import { openVSCodeRoute } from './routes/open-vscode.js';
import type { DaemonContext, LocalApiRequest } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default port for the local daemon API.
 * Override with the CHATROOM_LOCAL_API_PORT environment variable.
 */
export const LOCAL_API_PORT = 19847;

// ─── Server Handle ────────────────────────────────────────────────────────────

/**
 * Handle returned by {@link startLocalApi}.
 * Call `stop()` to gracefully shut down the server.
 */
export interface LocalApiHandle {
  /** Shut down the HTTP server. Resolves once all connections are closed. */
  stop: () => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the full request body from an incoming Node.js HTTP request.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Normalize a Node.js IncomingMessage into a {@link LocalApiRequest}.
 */
async function normalizeRequest(req: IncomingMessage): Promise<LocalApiRequest> {
  const body = await readBody(req);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    }
  }
  return {
    method: (req.method ?? 'GET').toUpperCase(),
    url: req.url ?? '/',
    headers,
    body: body || undefined,
  };
}

/**
 * Write a {@link LocalApiResponse} to a Node.js ServerResponse.
 */
function writeResponse(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string
): void {
  res.writeHead(status, headers);
  res.end(body);
}

// ─── Server Lifecycle ─────────────────────────────────────────────────────────

/**
 * Create a router pre-loaded with all known local API routes.
 */
function createRouter(): LocalApiRouter {
  const router = new LocalApiRouter();
  router.registerRoute(identityRoute);
  router.registerRoute(openFinderRoute);
  router.registerRoute(openGitHubDesktopRoute);
  router.registerRoute(openVSCodeRoute);
  return router;
}

/**
 * Resolve the port to bind, preferring the CHATROOM_LOCAL_API_PORT environment variable.
 */
function resolvePort(): number {
  const envPort = process.env.CHATROOM_LOCAL_API_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return LOCAL_API_PORT;
}

/**
 * Format an ISO timestamp prefix for log lines (consistent with daemon logging).
 */
function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Start the local daemon API HTTP server.
 *
 * Binds to 127.0.0.1 on the configured port (default: {@link LOCAL_API_PORT}).
 * If the port is already in use, logs a warning and resolves with a no-op stop handle
 * so that a port conflict does not crash the daemon.
 *
 * @param ctx   - Daemon context passed to route handlers.
 * @param port  - Port to bind (defaults to {@link resolvePort}).
 * @returns A handle with a `stop()` method for clean shutdown.
 */
export async function startLocalApi(
  ctx: DaemonContext,
  port: number = resolvePort()
): Promise<LocalApiHandle> {
  const router = createRouter();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const localReq = await normalizeRequest(req);
      const localRes = await router.handleRequest(localReq, ctx);
      writeResponse(
        res,
        localRes.status,
        { 'Content-Type': 'application/json', ...(localRes.headers ?? {}) },
        localRes.body
      );
    } catch {
      writeResponse(
        res,
        500,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ error: 'Internal server error' })
      );
    }
  });

  // Attempt to bind the server; handle port-in-use gracefully
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[${ts()}] 🌐 Local API started on http://localhost:${port}`);
      resolve();
    });

    server.on('error', (err: NodeError) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[${ts()}] ⚠️  Local API port ${port} already in use — skipping local API`);
      } else {
        console.warn(`[${ts()}] ⚠️  Local API failed to start: ${err.message}`);
      }
      resolve(); // Non-fatal — resolve so the daemon continues
    });
  });

  const stop = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`[${ts()}] 🌐 Local API stopped`);
          resolve();
        }
      });
    });

  return { stop };
}
