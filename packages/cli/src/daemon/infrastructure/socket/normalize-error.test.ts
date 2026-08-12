import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { normalizeError } from './normalize-error.js';

describe('normalizeError', () => {
  it('maps ZodError to validation_error', () => {
    try {
      z.object({ n: z.number() }).parse({ n: 'x' });
    } catch (err) {
      const normalized = normalizeError(err);
      expect(normalized.code).toBe('validation_error');
      expect(normalized.message).toBe('Invalid request payload');
      expect(normalized.details).toBeDefined();
    }
  });

  it('maps Error to internal_error by default', () => {
    const normalized = normalizeError(new Error('boom'));
    expect(normalized).toEqual({ code: 'internal_error', message: 'boom' });
  });

  it('preserves known error codes on Error', () => {
    const err = new Error('missing') as Error & { code: string };
    err.code = 'not_found';
    expect(normalizeError(err)).toEqual({ code: 'not_found', message: 'missing' });
  });
});
