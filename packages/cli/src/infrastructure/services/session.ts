/**
 * SessionService — Effect-TS service definition for authentication.
 *
 * Wraps SessionOps in an Effect Context.Tag for dependency injection via Layers.
 * Phase 1: Define service interface; existing SessionOps consumers unchanged until Phase 2+.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Context, Effect, Layer } from 'effect';

export interface SessionServiceShape {
  /** Get the current session ID, or null if not authenticated */
  getSessionId: () => Effect.Effect<SessionId | null>;
  /** Get the Convex deployment URL */
  getConvexUrl: () => Effect.Effect<string>;
  /** Get URLs of other authenticated sessions (for error guidance) */
  getOtherSessionUrls: () => Effect.Effect<string[]>;
}

export class SessionService extends Context.Tag('SessionService')<
  SessionService,
  SessionServiceShape
>() {}

/**
 * Live layer — constructed with concrete implementations at wiring time.
 *
 * @param ops - Object with session operations
 * @returns Layer providing SessionService
 */
export const SessionServiceLive = (ops: {
  getSessionId: () => Promise<SessionId | null>;
  getConvexUrl: () => string;
  getOtherSessionUrls: () => Promise<string[]>;
}): Layer.Layer<SessionService> =>
  Layer.succeed(SessionService, {
    getSessionId: () => Effect.promise(() => ops.getSessionId()),
    getConvexUrl: () => Effect.sync(() => ops.getConvexUrl()),
    getOtherSessionUrls: () => Effect.promise(() => ops.getOtherSessionUrls()),
  });
