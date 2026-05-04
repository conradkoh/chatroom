import { describe, it, expect } from 'vitest';

import {
  checkSession,
  type CheckSessionDeps,
} from './validate-session';

function createMockDeps(overrides: Partial<CheckSessionDeps> = {}): CheckSessionDeps {
  return {
    queryCliSession: async () => null,
    queryWebSession: async () => null,
    getUser: async () => null,
    ...overrides,
  };
}

describe('checkSession', () => {
  it('returns ok for active CLI session', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: true,
      }),
      getUser: async () => ({ id: 'user-1', name: 'Alice' }),
    });

    const result = await checkSession(deps, 'session-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('user-1');
      expect(result.userName).toBe('Alice');
      expect(result.sessionType).toBe('cli');
    }
  });

  it('returns ok for web session when CLI session not found', async () => {
    const deps = createMockDeps({
      queryWebSession: async () => ({ userId: 'user-2' }),
      getUser: async () => ({ id: 'user-2', name: 'Bob' }),
    });

    const result = await checkSession(deps, 'session-2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('user-2');
      expect(result.sessionType).toBe('web');
    }
  });

  it('returns not ok when CLI session is revoked', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: false,
      }),
    });

    const result = await checkSession(deps, 'session-1');
    expect(result.ok).toBe(false);
  });

  it('returns not ok when CLI session is expired', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: true,
        expiresAt: Date.now() - 10000,
      }),
    });

    const result = await checkSession(deps, 'session-1');
    expect(result.ok).toBe(false);
  });

  it('returns not ok when no sessions found', async () => {
    const deps = createMockDeps();

    const result = await checkSession(deps, 'nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('Session not found or invalid');
    }
  });

  it('returns not ok when CLI session user not found', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-missing',
        isActive: true,
      }),
      getUser: async () => null,
    });

    const result = await checkSession(deps, 'session-1');
    expect(result.ok).toBe(false);
  });

  it('falls back to web session when CLI user not found', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-missing',
        isActive: true,
      }),
      queryWebSession: async () => ({ userId: 'user-2' }),
      getUser: async (userId) => {
        if (userId === 'user-2') return { id: 'user-2', name: 'Bob' };
        return null;
      },
    });

    const result = await checkSession(deps, 'session-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionType).toBe('web');
    }
  });
});
