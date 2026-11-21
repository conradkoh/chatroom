import { describe, expect, it } from 'bun:test';

import {
  buildConvexDevArgs,
  isLocalConvexUrl,
  requireConfiguredDeployment,
} from './start-convex-dev';

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

describe('requireConfiguredDeployment', () => {
  it('returns the configured deployment name unchanged', () => {
    expect(requireConfiguredDeployment('conradkoh:chatroom-a8c82:dev/conradkoh')).toBe(
      'conradkoh:chatroom-a8c82:dev/conradkoh'
    );
  });

  it('fails fast with an actionable message when CONVEX_DEPLOYMENT is missing or empty', () => {
    expect(() => requireConfiguredDeployment(undefined)).toThrow(
      /CONVEX_DEPLOYMENT is not set in .*\.env\.local/
    );
    expect(() => requireConfiguredDeployment('')).toThrow(
      /CONVEX_DEPLOYMENT is not set in .*\.env\.local/
    );
  });
});
