import type { Server, Socket } from 'socket.io';

import { normalizeError } from './normalize-error.js';
import { harnessHistoryInputSchema } from './schemas.js';
import type { SocketAck } from '../../domain/entities/socket-ack.js';
import { getLocalWebHealth } from '../../domain/usecase/get-local-web-health.js';
import { listHarnessHistory } from '../../domain/usecase/list-harness-history.js';
import type { HarnessStreamEvent, StreamHub } from '../../local-web/server/stream-hub.js';
import type { HarnessStreamRepository } from '../repository/harness-stream-repository.js';

export type RegisterSocketHandlersDeps = {
  port: number;
  harnessStreamRepo: HarnessStreamRepository;
  streamHub: StreamHub;
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

    socket.on('disconnect', () => {
      for (const unsub of streamUnsubs) unsub();
    });
  });
}
