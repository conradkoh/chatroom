import { io } from 'socket.io-client';

type SocketError = {
  message?: string | undefined;
  code?: string | undefined;
  details?: unknown | undefined;
};
type SocketResponse<T> = { ok: true; data: T } | { ok: false; error?: SocketError | undefined };

export class LocalDaemonServerError extends Error {
  readonly code: string | undefined;
  readonly details: unknown | undefined;

  constructor(error: SocketError) {
    super(error.message ?? 'Daemon request failed');
    this.name = 'LocalDaemonServerError';
    this.code = error.code;
    this.details = error.details;
  }
}

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
    if (!response.ok) {
      throw new LocalDaemonServerError({
        message: response.error?.message ?? `Daemon request failed: ${event}`,
        code: response.error?.code,
        details: response.error?.details,
      });
    }
    return response.data;
  } finally {
    socket.disconnect();
  }
}
