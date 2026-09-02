/** Normalized error shape returned in socket ack payloads. */
export type AppErrorCode = 'validation_error' | 'not_found' | 'internal_error' | 'unauthorized';

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown | undefined;
};
