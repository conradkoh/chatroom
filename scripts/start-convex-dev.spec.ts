import { describe, expect, it } from 'bun:test';

import { buildConvexDevArgs, convexDevSpawnOptions } from './start-convex-dev';

describe('Convex dev command selection', () => {
  it('pins the backend version only for local deployments', () => {
    expect(buildConvexDevArgs(true, 'precompiled-test')).toEqual([
      'pnpm',
      'exec',
      'convex',
      'dev',
      '--local-backend-version',
      'precompiled-test',
    ]);
    expect(buildConvexDevArgs(false, 'precompiled-test')).toEqual([
      'pnpm',
      'exec',
      'convex',
      'dev',
    ]);
  });

  it('appends extra args such as --once after the pinned version', () => {
    expect(buildConvexDevArgs(true, 'precompiled-test', ['--once'])).toEqual([
      'pnpm',
      'exec',
      'convex',
      'dev',
      '--local-backend-version',
      'precompiled-test',
      '--once',
    ]);
  });
});

describe('convexDevSpawnOptions', () => {
  const base = { TZ: 'Asia/Singapore', PATH: '/bin', CONVEX_NON_INTERACTIVE: 'true' };

  it('removes TZ for a local deployment and keeps the other variables', () => {
    expect(convexDevSpawnOptions(true, base).env).toEqual({
      PATH: '/bin',
      CONVEX_NON_INTERACTIVE: 'true',
    });
  });

  it('keeps TZ for a hosted deployment', () => {
    expect(convexDevSpawnOptions(false, base).env).toEqual(base);
  });

  it('runs in services/backend with inherited stdio', () => {
    const options = convexDevSpawnOptions(false, base);
    expect(options.cwd.endsWith('services/backend')).toBe(true);
    expect([options.stdin, options.stdout, options.stderr]).toEqual([
      'inherit',
      'inherit',
      'inherit',
    ]);
  });

  it('does not mutate the base env', () => {
    convexDevSpawnOptions(true, base);
    expect(base.TZ).toBe('Asia/Singapore');
  });
});
