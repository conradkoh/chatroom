import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect, Layer } from 'effect';

import type { BackendService } from './backend.js';
import { BackendServiceLive } from './backend.js';
import type { CliGatewayService } from './cli-gateway.js';
import { CliGatewayServiceLive } from './cli-gateway.js';
import { SessionService, SessionServiceLive } from './session.js';
import type { HandoffGatewayOps } from '../../commands/handoff/deps.js';
import type { BackendOps, SessionOps } from '../deps/index.js';

export type CommandServicesDeps = {
  backend: BackendOps & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action?: ((endpoint: any, args: any) => Promise<any>) | undefined;
  };
  session: SessionOps;
  gateway?: HandoffGatewayOps;
};

export function commandServicesLayerFromDeps(
  deps: CommandServicesDeps
): Layer.Layer<BackendService | CliGatewayService | SessionService> {
  const gateway: HandoffGatewayOps = deps.gateway ?? {
    handoff: async () => {
      throw new Error('CLI gateway is unavailable');
    },
  };
  return Layer.mergeAll(
    CliGatewayServiceLive(gateway),
    BackendServiceLive({
      query: deps.backend.query,
      mutation: deps.backend.mutation,
      ...(deps.backend.action ? { action: deps.backend.action } : {}),
    }),
    SessionServiceLive({
      getSessionId: deps.session.getSessionId,
      getConvexUrl: deps.session.getConvexUrl,
      getOtherSessionUrls: deps.session.getOtherSessionUrls,
    })
  );
}

export function requireSessionIdEffect<E>(
  fail: (args: { convexUrl: string; otherUrls: string[] }) => E
): Effect.Effect<SessionId, E, SessionService> {
  return Effect.gen(function* () {
    const session = yield* SessionService;
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      const convexUrl = yield* session.getConvexUrl();
      return yield* Effect.fail(fail({ convexUrl, otherUrls }));
    }
    return sessionId;
  });
}

export function validateChatroomIdEffect<E>(
  chatroomId: string,
  fail: (id: string) => E
): Effect.Effect<void, E> {
  const valid =
    typeof chatroomId === 'string' && chatroomId.length >= 20 && chatroomId.length <= 40;
  return valid ? Effect.void : Effect.fail(fail(chatroomId));
}
