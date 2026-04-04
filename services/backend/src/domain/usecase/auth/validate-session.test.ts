import { describe, it, expect } from 'vitest';
import {
  validateSession,
  type ValidateSessionDeps,
} from './validate-session';

function createMockDeps(overrides: Partial<ValidateSessionDeps> = {}): ValidateSessionDeps {
  return {
    queryCliSession: async () => null,
    queryWebSession: async () => null,
    getUser: async () => null,
    ...overrides,
  };
}

describe('validateSession', () => {
  it('returns valid result for active CLI session', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: true,
      }),
      getUser: async () => ({ id: 'user-1', name: 'Alice' }),
    });

    const result = await validateSession(deps, 'session-1');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.userId).toBe('user-1');
      expect(result.userName).toBe('Alice');
      expect(result.sessionType).toBe('cli');
    }
  });

  it('returns valid result for web session when CLI session not found', async () => {
    const deps = createMockDeps({
      queryWebSession: async () => ({ userId: 'user-2' }),
      getUser: async () => ({ id: 'user-2', name: 'Bob' }),
    });

    const result = await validateSession(deps, 'session-2');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.userId).toBe('user-2');
      expect(result.sessionType).toBe('web');
    }
  });

  it('returns invalid when CLI session is revoked', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: false,
      }),
    });

    const result = await validateSession(deps, 'session-1');
    expect(result.valid).toBe(false);
  });

  it('returns invalid when CLI session is expired', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-1',
        isActive: true,
        expiresAt: Date.now() - 10000, // expired
      }),
    });

    const result = await validateSession(deps, 'session-1');
    expect(result.valid).toBe(false);
  });

  it('returns invalid when no sessions found', async () => {
    const deps = createMockDeps();

    const result = await validateSession(deps, 'nonexistent');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('Session not found or invalid');
    }
  });

  it('returns invalid when CLI session user not found', async () => {
    const deps = createMockDeps({
      queryCliSession: async () => ({
        userId: 'user-missing',
        isActive: true,
      }),
      getUser: async () => null,
    });

    const result = await validateSession(deps, 'session-1');
    // CLI user not found, falls through to web session which also fails
    expect(result.valid).toBe(false);
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

    const result = await validateSession(deps, 'session-1');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sessionType).toBe('web');
    }
  });
});
