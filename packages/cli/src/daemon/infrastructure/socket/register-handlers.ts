import type { Server, Socket } from 'socket.io';

import { normalizeError } from './normalize-error.js';
import {
  harnessHistoryInputSchema,
  logHistoryInputSchema,
  logSourcesInputSchema,
} from './schemas.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { SocketAck } from '../../domain/entities/socket-ack.js';
import { getLocalWebHealth } from '../../domain/usecase/get-local-web-health.js';
import { listHarnessHistory } from '../../domain/usecase/list-harness-history.js';
import {
  listLogHistory,
  listLogSources,
  listLogDimensions,
} from '../../domain/usecase/list-log-history.js';
import { asConvexSessionId } from '../../entry/daemon-types.js';
import type { LogStreamEvent, LogStreamHub } from '../../local-web/server/log-stream-hub.js';
import type { HarnessStreamEvent, StreamHub } from '../../local-web/server/stream-hub.js';
import type { HarnessStreamRepository } from '../repository/harness-stream-repository.js';
import type { LogRepository } from '../repository/log-repository.js';

export type RegisterSocketHandlersDeps = {
  port: number;
  harnessStreamRepo: HarnessStreamRepository;
  streamHub: StreamHub;
  logRepo?: LogRepository;
  logStreamHub?: LogStreamHub;
  backend?: BackendOps;
  sessionId?: string;
};

type AckFn = (response: SocketAck<unknown>) => void;

function callAck(ack: unknown, response: SocketAck<unknown>): void {
  if (typeof ack === 'function') {
    (ack as AckFn)(response);
  }
}

function extractAck(args: unknown[]): { payload: unknown; ack: unknown } {
  const last = args[args.length - 1];
  if (typeof last === 'function') {
    return { payload: args.length > 1 ? args[0] : undefined, ack: last };
  }
  return { payload: args[0], ack: undefined };
}

export function registerSocketHandlers(io: Server, deps: RegisterSocketHandlersDeps): void {
  io.on('connection', (socket: Socket) => {
    const streamUnsubs: (() => void)[] = [];

    socket.on('health.get', (...args) => {
      const { ack } = extractAck(args);
      try {
        const data = getLocalWebHealth(deps.port);
        callAck(ack, { ok: true, data });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });

    socket.on('harness.history', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        const parsed = harnessHistoryInputSchema.parse(payload ?? {});
        const data = listHarnessHistory(deps.harnessStreamRepo, parsed);
        callAck(ack, { ok: true, data });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });

    socket.on('harness.stream.subscribe', (...args) => {
      const { ack } = extractAck(args);
      try {
        const send = (event: HarnessStreamEvent) => {
          socket.emit('harness.stream', event);
        };
        const unsub = deps.streamHub.subscribe(send);
        streamUnsubs.push(unsub);
        callAck(ack, { ok: true, data: { subscribed: true } });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });

    socket.on('logs.history', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!deps.logRepo) throw new Error('log repository not configured');
        callAck(ack, {
          ok: true,
          data: listLogHistory(deps.logRepo, logHistoryInputSchema.parse(payload ?? {})),
        });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('logs.sources', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!deps.logRepo) throw new Error('log repository not configured');
        const parsed = logSourcesInputSchema.parse(payload ?? {});
        callAck(ack, { ok: true, data: listLogSources(deps.logRepo, parsed.limit) });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('logs.dimensions', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!deps.logRepo) throw new Error('log repository not configured');
        const parsed = logSourcesInputSchema.parse(payload ?? {});
        callAck(ack, { ok: true, data: listLogDimensions(deps.logRepo, parsed.limit) });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('chatrooms.list', async (...args) => {
      const { ack } = extractAck(args);
      try {
        if (!deps.backend || !deps.sessionId) throw new Error('backend session not configured');
        const chatrooms = (await deps.backend.query(api.chatrooms.listByUser, {
          sessionId: asConvexSessionId(deps.sessionId),
        })) as { _id: string; name?: string; teamName?: string }[];
        callAck(ack, {
          ok: true,
          data: {
            chatrooms: chatrooms.map((c) => ({
              id: c._id,
              displayName: c.name?.trim() || c.teamName?.trim() || c._id,
            })),
          },
        });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('logs.stream.subscribe', (...args) => {
      const { ack } = extractAck(args);
      try {
        if (!deps.logStreamHub) throw new Error('log stream hub not configured');
        const unsub = deps.logStreamHub.subscribe((event: LogStreamEvent) =>
          socket.emit('logs.stream', event)
        );
        streamUnsubs.push(unsub);
        callAck(ack, { ok: true, data: { subscribed: true } });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });

    socket.on('disconnect', () => {
      for (const unsub of streamUnsubs) unsub();
    });
  });
}
