import { afterEach, describe, expect, it } from 'vitest';

import {
  NON_PRODUCTION_LOCAL_WEB_PORT,
  PRODUCTION_LOCAL_WEB_PORT,
  resolveDefaultLocalWebPort,
  resolveLocalWebPort,
} from './resolve-local-web-port.js';

const PROD = 'https://chatroom-cloud.duskfare.com';
const LOCAL = 'http://127.0.0.1:3210';

describe('resolveDefaultLocalWebPort', () => {
  it('returns production port for production convex URL', () => {
    expect(resolveDefaultLocalWebPort(PROD)).toBe(PRODUCTION_LOCAL_WEB_PORT);
  });

  it('returns non-production port for local convex URL', () => {
    expect(resolveDefaultLocalWebPort(LOCAL)).toBe(NON_PRODUCTION_LOCAL_WEB_PORT);
  });
});

describe('resolveLocalWebPort', () => {
  const original = process.env.CHATROOM_LOCAL_WEB_PORT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHATROOM_LOCAL_WEB_PORT;
    } else {
      process.env.CHATROOM_LOCAL_WEB_PORT = original;
    }
  });

  it('prefers CHATROOM_LOCAL_WEB_PORT override', () => {
    expect(resolveLocalWebPort({ CHATROOM_LOCAL_WEB_PORT: '9999' }, PROD)).toBe(9999);
  });

  it('falls back to production default when no override and production URL', () => {
    expect(resolveLocalWebPort({}, PROD)).toBe(PRODUCTION_LOCAL_WEB_PORT);
  });

  it('falls back to non-production default when no override and local URL', () => {
    expect(resolveLocalWebPort({}, LOCAL)).toBe(NON_PRODUCTION_LOCAL_WEB_PORT);
  });
});
