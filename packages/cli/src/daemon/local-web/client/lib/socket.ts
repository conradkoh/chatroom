import { io, type Socket } from 'socket.io-client';

import type {
  ChatroomsListAck,
  HealthGetAck,
  LogLine,
  LogsDimensionsAck,
  LogsHistoryAck,
  LogsSourcesAck,
  LogHistoryInput,
} from '../api/types.js';

let socket: Socket | null = null;
let daemonSocket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket'], autoConnect: true });
  }
  return socket;
}

export async function fetchHealth(): Promise<HealthGetAck> {
  const s = getSocket();
  await ensureConnected(s);
  return s.emitWithAck('health.get') as Promise<HealthGetAck>;
}
async function ensureConnected(s: Socket): Promise<void> {
  if (!s.connected) {
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        s.off('connect', onConnect);
        s.off('connect_error', onError);
      };
      s.on('connect', onConnect);
      s.on('connect_error', onError);
      s.connect();
    });
  }
}
export async function fetchLogHistory(input?: LogHistoryInput): Promise<LogsHistoryAck> {
  const s = getSocket();
  await ensureConnected(s);
  return s.emitWithAck('logs.history', input ?? {}) as Promise<LogsHistoryAck>;
}
export async function fetchLogDimensions(limit?: number): Promise<LogsDimensionsAck> {
  const s = getSocket();
  await ensureConnected(s);
  return s.emitWithAck('logs.dimensions', { limit }) as Promise<LogsDimensionsAck>;
}
export async function fetchChatrooms(): Promise<ChatroomsListAck> {
  const s = getSocket();
  await ensureConnected(s);
  return s.emitWithAck('chatrooms.list') as Promise<ChatroomsListAck>;
}
export async function fetchLogSources(limit?: number): Promise<LogsSourcesAck> {
  const s = getSocket();
  await ensureConnected(s);
  return s.emitWithAck('logs.sources', { limit }) as Promise<LogsSourcesAck>;
}

export async function ingestChatroomEvent(
  event: Record<string, unknown>,
  port: number
): Promise<void> {
  if (!daemonSocket) {
    daemonSocket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], autoConnect: true });
  }
  const s = daemonSocket;
  await ensureConnected(s);
  const response = (await s.emitWithAck('logs.events.ingest', event)) as {
    ok: boolean;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(response.error?.message ?? 'Failed to ingest chatroom event');
  }
}
export function subscribeLogStream(onLine: (line: LogLine) => void): () => void {
  const s = getSocket();
  s.connect();
  s.emit('logs.stream.subscribe');
  s.on('logs.stream', onLine);
  return () => s.off('logs.stream', onLine);
}
