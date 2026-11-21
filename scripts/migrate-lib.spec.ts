import { describe, expect, it } from 'bun:test';

import { type ConvexTarget } from './convex-target';
import { convexRunEnv, describeMigrationError } from './migrate-lib';

describe('describeMigrationError', () => {
  it('prefers the trimmed stderr of a failed convex run', () => {
    expect(describeMigrationError({ stderr: Buffer.from('migrations:x failed: boom\n') })).toBe(
      'migrations:x failed: boom'
    );
  });

  it('falls back to the error message, then to the string form', () => {
    expect(describeMigrationError(new Error('plain'))).toBe('plain');
    expect(describeMigrationError('text')).toBe('text');
  });

  it('treats an undefined stderr as absent and keeps the error message', () => {
    expect(
      describeMigrationError(
        Object.assign(new Error('connect ECONNREFUSED'), { stderr: undefined })
      )
    ).toBe('connect ECONNREFUSED');
  });
});

describe('convexRunEnv', () => {
  const env = { TZ: 'Asia/Singapore', PATH: '/bin' };

  it('removes TZ for a local development deployment', () => {
    const local: ConvexTarget = {
      kind: 'local',
      deployment: 'local:local-acme-demo-2',
      url: 'http://127.0.0.1:3210',
    };
    expect(convexRunEnv(local, env)).toEqual({ PATH: '/bin' });
  });

  it('keeps TZ for a hosted development deployment', () => {
    const hosted: ConvexTarget = {
      kind: 'hosted-dev',
      deployment: 'dev:happy-animal-123',
      url: 'https://happy-animal-123.convex.cloud',
    };
    expect(convexRunEnv(hosted, env)).toEqual(env);
  });

  it('keeps TZ for production', () => {
    expect(convexRunEnv({ kind: 'production' }, env)).toEqual(env);
  });

  it('does not mutate the base env', () => {
    convexRunEnv({ kind: 'local', deployment: 'local:x' }, env);
    expect(env.TZ).toBe('Asia/Singapore');
  });
});
