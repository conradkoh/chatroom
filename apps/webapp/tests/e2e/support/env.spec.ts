import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getConvexUrl, getWebappBaseUrl, getWebappPort, parseEnvContent } from './env';

describe('parseEnvContent', () => {
  it('parses simple key=value', () => {
    expect(parseEnvContent('PORT=3001\n')).toEqual({ PORT: '3001' });
  });

  it('strips double-quoted values', () => {
    expect(parseEnvContent('PORT="3001"\n')).toEqual({ PORT: '3001' });
  });

  it('handles export prefix', () => {
    expect(parseEnvContent('export PORT=3001\n')).toEqual({ PORT: '3001' });
  });
});

describe('getWebappPort', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('prefers process.env.PORT when set', () => {
    vi.stubEnv('PORT', '4000');
    expect(getWebappPort()).toBe('4000');
  });

  it('falls back to 3000 when PORT is empty in env and file', () => {
    vi.stubEnv('PORT', '');
    vi.spyOn(fs, 'readFileSync').mockReturnValue('PORT=\n');
    expect(getWebappPort()).toBe('3000');
  });

  it('falls back to 3000 when PORT is whitespace in env and file', () => {
    vi.stubEnv('PORT', '   ');
    vi.spyOn(fs, 'readFileSync').mockReturnValue('PORT=   \n');
    expect(getWebappPort()).toBe('3000');
  });
});

describe('getWebappBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns localhost URL with resolved port', () => {
    vi.stubEnv('PORT', '3001');
    expect(getWebappBaseUrl()).toBe('http://localhost:3001');
  });
});

describe('getConvexUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('prefers process.env.NEXT_PUBLIC_CONVEX_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example.convex.cloud');
    expect(getConvexUrl()).toBe('https://example.convex.cloud');
  });
});
