/**
 * Upload URL guard tests.
 *
 * The guard is pure: every case calls the public function with an explicit backend URL and a
 * rejecting factory, so the test observes the message and the exact error instance thrown.
 */

import { describe, expect, test } from 'vitest';

import { assertUploadUrlAllowed } from './upload-url-guard.js';

class TestRejectedUrlError extends Error {}

const mk = (message: string): Error => new TestRejectedUrlError(message);

describe('assertUploadUrlAllowed', () => {
  test('accepts the production Convex site origin paired with the cloud backend', () => {
    expect(() =>
      assertUploadUrlAllowed('https://a.convex.site/x', 'https://a.convex.cloud', mk)
    ).not.toThrow();
  });

  test('accepts the local Convex site port next to the loopback backend port', () => {
    expect(() =>
      assertUploadUrlAllowed('http://127.0.0.1:3211/x', 'http://127.0.0.1:3210', mk)
    ).not.toThrow();
  });

  test('rejects a foreign origin', () => {
    expect(() =>
      assertUploadUrlAllowed('https://evil.example/x', 'https://a.convex.cloud', mk)
    ).toThrow(/does not match the configured backend/);
  });

  test('rejects plaintext uploads outside loopback', () => {
    expect(() =>
      assertUploadUrlAllowed('http://example.com/x', 'https://a.convex.cloud', mk)
    ).toThrow(/must use HTTPS/);
  });

  test('rejects a URL that cannot be parsed', () => {
    expect(() => assertUploadUrlAllowed('not a url', 'https://a.convex.cloud', mk)).toThrow(
      /not a valid URL/
    );
  });

  test('throws the error built by the caller-supplied factory', () => {
    expect(() =>
      assertUploadUrlAllowed('https://evil.example/x', 'https://a.convex.cloud', mk)
    ).toThrow(TestRejectedUrlError);
  });
});
