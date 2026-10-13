import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './convexError';

describe('getErrorMessage', () => {
  it('returns the message carried in a ConvexError payload', () => {
    const error = new ConvexError({ code: 'AGENT_BUSY', message: 'Agent is already running' });

    expect(getErrorMessage(error, 'Fallback')).toBe('Agent is already running');
  });

  it('falls back when a ConvexError payload has no message', () => {
    const error = new ConvexError({ code: 'AGENT_BUSY' });

    expect(getErrorMessage(error, 'Fallback')).toBe('Fallback');
  });

  it('returns the message of a plain Error', () => {
    expect(getErrorMessage(new Error('boom'), 'Fallback')).toBe('boom');
  });

  it('returns the fallback for a value that is not an Error', () => {
    expect(getErrorMessage('boom', 'Fallback')).toBe('Fallback');
  });
});
