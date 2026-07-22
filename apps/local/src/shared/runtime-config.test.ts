import { describe, it, expect } from 'vitest';

import {
  defaultConvexBackendMode,
  findHostedConvexUrl,
  findLocalConvexUrl,
} from './runtime-config.js';

describe('convex env URL helpers', () => {
  it('prefers hosted URL when backend is local and webapp is hosted', () => {
    const hostedUrl = findHostedConvexUrl(
      'http://127.0.0.1:3210',
      'https://wonderful-raven-192.convex.cloud'
    );
    const localUrl = findLocalConvexUrl(
      'http://127.0.0.1:3210',
      'https://wonderful-raven-192.convex.cloud'
    );
    expect(hostedUrl).toBe('https://wonderful-raven-192.convex.cloud');
    expect(localUrl).toBe('http://127.0.0.1:3210');
    expect(defaultConvexBackendMode(hostedUrl)).toBe('hosted');
  });

  it('uses local URL when no hosted URL is present', () => {
    const hostedUrl = findHostedConvexUrl('http://127.0.0.1:3210', undefined);
    const localUrl = findLocalConvexUrl('http://127.0.0.1:3210', undefined);
    expect(hostedUrl).toBeNull();
    expect(localUrl).toBe('http://127.0.0.1:3210');
    expect(defaultConvexBackendMode(hostedUrl)).toBe('local');
  });
});
