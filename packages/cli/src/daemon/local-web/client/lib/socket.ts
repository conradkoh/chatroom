import { io, type Socket } from 'socket.io-client';

import type { HealthGetAck } from '../api/types.js';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ['websocket'], autoConnect: true });
  }
  return socket;
}

export async function fetchHealth(): Promise<HealthGetAck> {
  const s = getSocket();
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
  return s.emitWithAck('health.get') as Promise<HealthGetAck>;
}
