import { io } from 'socket.io-client';

type SocketResponse<T> =
  { ok: true; data: T } | { ok: false; error?: { message?: string | undefined } | undefined };

/** Request a diagnostic payload from the daemon's loopback-only local web API. */
export async function requestLocalDaemon<T>(
  port: number,
  event: string,
  payload?: unknown
): Promise<T> {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    autoConnect: false,
    timeout: 2_000,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });

    const response = (await socket
      .timeout(10_000)
      .emitWithAck(event, payload)) as SocketResponse<T>;
    if (!response.ok) throw new Error(response.error?.message ?? `Daemon request failed: ${event}`);
    return response.data;
  } finally {
    socket.disconnect();
  }
}
