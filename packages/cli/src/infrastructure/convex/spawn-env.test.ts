import { describe, it, expect, afterEach } from 'vitest';

import {
  buildAgentSpawnEnv,
  buildChatroomSpawnEnv,
  formatConvexUrlMismatchWarning,
} from './spawn-env.js';

const PROD = 'https://chatroom-cloud.duskfare.com';
const LOCAL = 'http://localhost:3210';

describe('buildChatroomSpawnEnv', () => {
  const original = process.env.CHATROOM_CONVEX_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHATROOM_CONVEX_URL;
    } else {
      process.env.CHATROOM_CONVEX_URL = original;
    }
  });

  it('strips CHATROOM_CONVEX_URL for production resolved URL even when parent env is local', () => {
    process.env.CHATROOM_CONVEX_URL = LOCAL;
    const env = buildChatroomSpawnEnv(PROD, { GIT_EDITOR: 'true' });
    expect(env.CHATROOM_CONVEX_URL).toBeUndefined();
    expect(env.GIT_EDITOR).toBe('true');
  });

  it('sets CHATROOM_CONVEX_URL for non-production resolved URL', () => {
    const env = buildChatroomSpawnEnv(LOCAL);
    expect(env.CHATROOM_CONVEX_URL).toBe(LOCAL);
  });
});

describe('buildAgentSpawnEnv', () => {
  const original = process.env.CHATROOM_CONVEX_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHATROOM_CONVEX_URL;
    } else {
      process.env.CHATROOM_CONVEX_URL = original;
    }
  });

  it('buildAgentSpawnEnv sets GIT_EDITOR overrides and strips prod URL', () => {
    process.env.CHATROOM_CONVEX_URL = LOCAL;
    const env = buildAgentSpawnEnv(PROD);
    expect(env.CHATROOM_CONVEX_URL).toBeUndefined();
    expect(env.GIT_EDITOR).toBe('true');
    expect(env.GIT_SEQUENCE_EDITOR).toBe('true');
  });
});

describe('formatConvexUrlMismatchWarning', () => {
  const original = process.env.CHATROOM_CONVEX_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHATROOM_CONVEX_URL;
    } else {
      process.env.CHATROOM_CONVEX_URL = original;
    }
  });

  it('returns warning when shell env differs from resolved', () => {
    process.env.CHATROOM_CONVEX_URL = LOCAL;
    expect(formatConvexUrlMismatchWarning(PROD)).toMatch(/differs from daemon/);
  });

  it('returns null when env matches resolved URL', () => {
    process.env.CHATROOM_CONVEX_URL = PROD;
    expect(formatConvexUrlMismatchWarning(PROD)).toBeNull();
  });

  it('returns null when env is unset', () => {
    delete process.env.CHATROOM_CONVEX_URL;
    expect(formatConvexUrlMismatchWarning(PROD)).toBeNull();
  });
});
