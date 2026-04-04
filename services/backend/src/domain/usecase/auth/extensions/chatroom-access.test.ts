import { describe, it, expect } from 'vitest';
import {
  checkChatroomAccess,
  type ChatroomAccessDeps,
} from './chatroom-access';

function createMockDeps(overrides: Partial<ChatroomAccessDeps> = {}): ChatroomAccessDeps {
  return {
    getChatroom: async () => null,
    ...overrides,
  };
}

describe('checkChatroomAccess', () => {
  it('grants access when user is the chatroom owner', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chatroom-1', ownerId: 'user-1' }),
    });

    const result = await checkChatroomAccess(deps, 'chatroom-1', 'user-1');
    expect(result.hasAccess).toBe(true);
    if (result.hasAccess) {
      expect(result.chatroomId).toBe('chatroom-1');
    }
  });

  it('denies access when user is not the owner', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chatroom-1', ownerId: 'user-2' }),
    });

    const result = await checkChatroomAccess(deps, 'chatroom-1', 'user-1');
    expect(result.hasAccess).toBe(false);
    if (!result.hasAccess) {
      expect(result.reason).toContain('Access denied');
    }
  });

  it('denies access when chatroom not found', async () => {
    const deps = createMockDeps();

    const result = await checkChatroomAccess(deps, 'nonexistent', 'user-1');
    expect(result.hasAccess).toBe(false);
    if (!result.hasAccess) {
      expect(result.reason).toBe('Chatroom not found');
    }
  });
});
