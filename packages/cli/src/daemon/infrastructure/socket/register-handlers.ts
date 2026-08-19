import type { Server, Socket } from 'socket.io';

import { normalizeError } from './normalize-error.js';
import {
  chatroomEventIngestInputSchema,
  eventStreamHistoryInputSchema,
  harnessHistoryInputSchema,
  logHistoryInputSchema,
  logSourcesInputSchema,
} from './schemas.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { SocketAck } from '../../domain/entities/socket-ack.js';
import { createEventStreamHistoryUseCase } from '../../domain/usecase/event-stream-history.js';
import { getLocalWebHealth } from '../../domain/usecase/get-local-web-health.js';
import { listHarnessHistory } from '../../domain/usecase/list-harness-history.js';
import { createLogDimensionsUseCase } from '../../domain/usecase/log-dimensions.js';
import { createLogEventIngestionUseCase } from '../../domain/usecase/log-event-ingestion.js';
import { createLogHistoryUseCase } from '../../domain/usecase/log-history.js';
import { createLogSourcesUseCase } from '../../domain/usecase/log-sources.js';
import { createSubscribeLogStreamUseCase } from '../../domain/usecase/subscribe-log-stream.js';
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
  const logHistory = deps.logRepo ? createLogHistoryUseCase({ reader: deps.logRepo }) : undefined;
  const eventStreamHistory = deps.logRepo
    ? createEventStreamHistoryUseCase({ reader: deps.logRepo })
    : undefined;
  const logEventIngestion = deps.logRepo
    ? createLogEventIngestionUseCase({ writer: deps.logRepo })
    : undefined;
  const logSources = deps.logRepo ? createLogSourcesUseCase({ reader: deps.logRepo }) : undefined;
  const logDimensions = deps.logRepo
    ? createLogDimensionsUseCase({ reader: deps.logRepo })
    : undefined;
  const subscribeLogStream = deps.logStreamHub
    ? createSubscribeLogStreamUseCase({ hub: deps.logStreamHub })
    : undefined;
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
        if (!logHistory) throw new Error('log history use case not configured');
        callAck(ack, {
          ok: true,
          data: logHistory(logHistoryInputSchema.parse(payload ?? {})),
        });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('eventStream.ingest', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!logEventIngestion) throw new Error('log event ingestion use case not configured');
        const event = chatroomEventIngestInputSchema.parse(payload);
        callAck(ack, { ok: true, data: logEventIngestion(event) });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('eventStream.history', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!eventStreamHistory) throw new Error('event stream use case not configured');
        const input = eventStreamHistoryInputSchema.parse(payload ?? {});
        callAck(ack, { ok: true, data: eventStreamHistory(input) });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('logs.sources', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!logSources) throw new Error('log sources use case not configured');
        const parsed = logSourcesInputSchema.parse(payload ?? {});
        callAck(ack, { ok: true, data: logSources(parsed.limit) });
      } catch (err) {
        callAck(ack, { ok: false, error: normalizeError(err) });
      }
    });
    socket.on('logs.dimensions', (...args) => {
      const { payload, ack } = extractAck(args);
      try {
        if (!logDimensions) throw new Error('log dimensions use case not configured');
        const parsed = logSourcesInputSchema.parse(payload ?? {});
        callAck(ack, { ok: true, data: logDimensions(parsed.limit) });
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
        if (!subscribeLogStream) throw new Error('log stream use case not configured');
        const unsub = subscribeLogStream((event: LogStreamEvent) =>
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
