export type AppErrorCode = 'validation_error' | 'not_found' | 'internal_error' | 'unauthorized';

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
};

export type SocketAckSuccess<T> = { ok: true; data: T };
export type SocketAckFailure = { ok: false; error: AppError };
export type SocketAck<T> = SocketAckSuccess<T> | SocketAckFailure;

export type LocalWebHealth = {
  status: 'ok';
  service: 'v2-local-web';
  port: number;
};

export type HealthGetAck = SocketAck<LocalWebHealth>;
