import { ConvexError } from 'convex/values';
import { ZodError } from 'zod';

import type { AppError } from '../../domain/entities/app-error.js';

// fallow-ignore-next-line complexity
export function normalizeError(err: unknown): AppError {
  if (err instanceof ZodError) {
    return {
      code: 'validation_error',
      message: 'Invalid request payload',
      details: err.flatten(),
    };
  }
  if (err instanceof ConvexError) {
    const data = err.data as { code?: string; message?: string };
    return {
      code: (data.code ?? 'internal_error') as AppError['code'],
      message: data.message ?? err.message,
      details: err.data,
    };
  }
  if (err instanceof Error) {
    const code =
      'code' in err && typeof (err as { code?: string | undefined }).code === 'string'
        ? ((err as { code: string }).code as AppError['code'])
        : 'internal_error';
    if (code === 'not_found' || code === 'validation_error' || code === 'unauthorized') {
      return { code, message: err.message };
    }
    return { code: 'internal_error', message: err.message };
  }
  return { code: 'internal_error', message: 'Unknown error' };
}
