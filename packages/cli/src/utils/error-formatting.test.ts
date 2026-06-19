/**
 * Unit tests for network error detection in error-formatting utilities.
 */

import { describe, expect, it } from 'vitest';

import { isNetworkError } from './error-formatting.js';

describe('isNetworkError', () => {
  it('detects fetch and connection errors from message text', () => {
    expect(isNetworkError(new Error('fetch failed'))).toBe(true);
    expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isNetworkError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(true);
    expect(isNetworkError(new Error('network timeout'))).toBe(true);
    expect(isNetworkError(new Error('socket hang up'))).toBe(true);
  });

  it('detects network errors from error codes', () => {
    expect(isNetworkError({ code: 'ECONNREFUSED', message: 'connect failed' })).toBe(true);
    expect(isNetworkError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe(true);
  });

  it('does not classify auth or application errors as network errors', () => {
    expect(isNetworkError(new Error('Not authenticated'))).toBe(false);
    expect(isNetworkError(new Error('Invalid chatroom ID'))).toBe(false);
    expect(isNetworkError(new Error('Forbidden'))).toBe(false);
  });
});
