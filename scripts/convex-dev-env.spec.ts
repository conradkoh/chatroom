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
    expect(buildConvexDevEnv({ TZ: 'Asia/Singapore', PATH: 'x' }, true, 'dev-name')).toEqual({
      PATH: 'x',
      CONVEX_DEPLOYMENT: 'dev-name',
    });
  });

  it('keeps TZ for hosted deployments', () => {
    expect(buildConvexDevEnv({ TZ: 'Asia/Singapore', PATH: 'x' }, false, 'dev-name')).toEqual({
      TZ: 'Asia/Singapore',
      PATH: 'x',
      CONVEX_DEPLOYMENT: 'dev-name',
    });
  });

  it('does not mutate the input object', () => {
    const base = { TZ: 'Asia/Singapore', PATH: 'x' };
    buildConvexDevEnv(base, true, 'dev-name');
    expect(base).toEqual({ TZ: 'Asia/Singapore', PATH: 'x' });
  });

  it('leaves inherited selectors untouched when no deployment is configured (codegen)', () => {
    expect(
      buildConvexDevEnv({ TZ: 'Asia/Singapore', CONVEX_DEPLOY_KEY: 'prod:fake-key' }, true)
    ).toEqual({ CONVEX_DEPLOY_KEY: 'prod:fake-key' });
  });
});

describe('buildConvexDevEnv deployment selection', () => {
  const configured = 'conradkoh:chatroom-a8c82:dev/conradkoh';

  it('replaces an inherited CONVEX_DEPLOYMENT with the configured one', () => {
    expect(
      buildConvexDevEnv(
        { CONVEX_DEPLOYMENT: 'other:project:dev/someone', PATH: 'x' },
        false,
        configured
      )
    ).toEqual({ CONVEX_DEPLOYMENT: configured, PATH: 'x' });
  });

  it('removes inherited deploy key and self-hosted selectors', () => {
    expect(
      buildConvexDevEnv(
        {
          CONVEX_DEPLOY_KEY: 'prod:fake-key',
          CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210',
          CONVEX_SELF_HOSTED_ADMIN_KEY: 'fake-admin',
          PATH: 'x',
        },
        false,
        configured
      )
    ).toEqual({ CONVEX_DEPLOYMENT: configured, PATH: 'x' });
  });
});
