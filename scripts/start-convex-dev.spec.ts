import { describe, expect, it } from 'bun:test';

import { buildConvexDevArgs, isLocalConvexUrl } from './start-convex-dev';

describe('Convex dev command selection', () => {
  it('recognizes loopback Convex URLs as local', () => {
    expect(isLocalConvexUrl('http://127.0.0.1:3210')).toBe(true);
    expect(isLocalConvexUrl('http://localhost:3210')).toBe(true);
    expect(isLocalConvexUrl('https://wonderful-raven-192.convex.cloud')).toBe(false);
  });

  it('pins the backend version only for local deployments', () => {
    expect(buildConvexDevArgs('http://127.0.0.1:3210', 'precompiled-test')).toEqual([
      'pnpm',
      'exec',
      'convex',
      'dev',
      '--local-backend-version',
      'precompiled-test',
    ]);
    expect(
      buildConvexDevArgs('https://wonderful-raven-192.convex.cloud', 'precompiled-test')
    ).toEqual(['pnpm', 'exec', 'convex', 'dev']);
  });
});
