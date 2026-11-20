import { afterEach, describe, expect, it } from 'bun:test';

import { applyConvexDevEnvDefaults, buildConvexDevEnv } from './convex-dev-env';

const KEYS = [
  'CONVEX_NON_INTERACTIVE',
  'DOCUMENT_RETENTION_DELAY',
  'INDEX_RETENTION_DELAY',
  'RETENTION_DELETE_FREQUENCY',
] as const;

describe('applyConvexDevEnvDefaults', () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('sets defaults when unset', () => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    applyConvexDevEnvDefaults();
    expect(process.env.CONVEX_NON_INTERACTIVE).toBe('true');
    expect(process.env.DOCUMENT_RETENTION_DELAY).toBe('1');
    expect(process.env.INDEX_RETENTION_DELAY).toBe('1');
    expect(process.env.RETENTION_DELETE_FREQUENCY).toBe('10');
  });

  it('does not overwrite existing values', () => {
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.CONVEX_NON_INTERACTIVE = 'false';
    applyConvexDevEnvDefaults();
    expect(process.env.CONVEX_NON_INTERACTIVE).toBe('false');
  });
});

describe('buildConvexDevEnv', () => {
  it('removes TZ for local deployments and keeps other variables', () => {
    expect(buildConvexDevEnv({ TZ: 'Asia/Singapore', PATH: 'x' }, true)).toEqual({ PATH: 'x' });
  });

  it('keeps TZ for hosted deployments', () => {
    expect(buildConvexDevEnv({ TZ: 'Asia/Singapore', PATH: 'x' }, false)).toEqual({
      TZ: 'Asia/Singapore',
      PATH: 'x',
    });
  });

  it('does not mutate the input object', () => {
    const base = { TZ: 'Asia/Singapore', PATH: 'x' };
    buildConvexDevEnv(base, true);
    expect(base).toEqual({ TZ: 'Asia/Singapore', PATH: 'x' });
  });
});
