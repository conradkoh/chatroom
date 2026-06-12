/**
 * GetNextTaskSessionService — Effect Context.Tag for GetNextTaskSession construction.
 *
 * Wraps the creation of `GetNextTaskSession` in an Effect service so tests can
 * inject a stub with a controllable `start()` without standing up a real
 * Convex WebSocket connection.
 */

import { Context } from 'effect';

import type { GetNextTaskSession, SessionParams } from './session.js';

export interface GetNextTaskSessionShape {
  /** Factory — creates a new GetNextTaskSession from the given params. */
  createSession: (params: SessionParams) => GetNextTaskSession;
}

export class GetNextTaskSessionService extends Context.Tag('GetNextTaskSessionService')<
  GetNextTaskSessionService,
  GetNextTaskSessionShape
>() {}
