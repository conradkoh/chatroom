import { describe, it, expect } from 'vitest';
import {
  checkChatroomAccess,
  type CheckChatroomAccessDeps,
} from './chatroom-access';

function createMockDeps(overrides: Partial<CheckChatroomAccessDeps> = {}): CheckChatroomAccessDeps {
  return {
    getChatroom: async () => null,
    ...overrides,
  };
}

describe('checkChatroomAccess', () => {
  it('returns ok when user is the chatroom owner', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chatroom-1', ownerId: 'user-1' }),
    });

    const result = await checkChatroomAccess(deps, 'chatroom-1', 'user-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chatroomId).toBe('chatroom-1');
    }
  });

  it('returns not ok when user is not the owner', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chatroom-1', ownerId: 'user-2' }),
    });

    const result = await checkChatroomAccess(deps, 'chatroom-1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Access denied');
    }
  });

  it('returns not ok when chatroom not found', async () => {
    const deps = createMockDeps();

    const result = await checkChatroomAccess(deps, 'nonexistent', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('Chatroom not found');
    }
  });
});
