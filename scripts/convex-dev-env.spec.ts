import { afterEach, describe, expect, it } from 'bun:test';

import { applyConvexDevEnvDefaults } from './convex-dev-env';

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
