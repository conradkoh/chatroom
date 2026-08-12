import type { AppError } from './app-error.js';

export type SocketAckSuccess<T> = { ok: true; data: T };
export type SocketAckFailure = { ok: false; error: AppError };
export type SocketAck<T> = SocketAckSuccess<T> | SocketAckFailure;
