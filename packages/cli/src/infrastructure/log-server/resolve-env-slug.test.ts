import { describe, expect, it } from 'vitest';

import { resolveEnvSlug } from './resolve-env-slug.js';

describe('resolveEnvSlug', () => {
  it('uses local for loopback', () =>
    expect(resolveEnvSlug('http://localhost:3210')).toBe('local'));
  it('uses the first hostname segment', () =>
    expect(resolveEnvSlug('https://My_Env.example.com')).toBe('my-env'));
  it('falls back for invalid URLs', () => expect(resolveEnvSlug('nope')).toBe('default'));
});
