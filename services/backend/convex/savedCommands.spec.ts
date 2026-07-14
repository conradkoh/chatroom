/**
 * savedCommands Integration Tests
 *
 * Covers scope-aware CRUD: chatroom-scoped, user-scoped, duplicate detection,
 * auth enforcement, scope immutability, and prompt/name validation.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { createTestSession } from '../tests/helpers/integration';

// ─── Constants ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function setupUser(suffix: string): Promise<{
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
}> {
  const { sessionId } = await createTestSession(`saved-cmds-${suffix}`);
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId: sessionId,
    teamId: 'solo',
    teamName: 'Solo',
    teamRoles: ['user'],
    teamEntryPoint: 'user',
  });
  // Get user ID from sessions table
  const userId = await t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .unique();
    return session!.userId;
  });
  return { sessionId: sessionId, chatroomId, userId };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('savedCommands scope', () => {
  test('1. Create chatroom-scoped command → appears in list for that chatroom', async () => {
    const { sessionId, chatroomId } = await setupUser('chatroom-scoped');

    const cmdId = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'chatroom', name: 'Chat Cmd', prompt: 'Hello chatroom' },
    });
    expect(cmdId).toBeDefined();

    const list = await t.query(api.savedCommands.listSavedCommands, {
      sessionId,
      chatroomId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Chat Cmd');
    expect(list[0].scope).toBe('chatroom');
  });

  test('2. Create user-scoped command → appears in list for any chatroom owned by user', async () => {
    const { sessionId, chatroomId } = await setupUser('user-scoped');

    const cmdId = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'user', name: 'User Cmd', prompt: 'Hello everywhere' },
    });
    expect(cmdId).toBeDefined();

    const list = await t.query(api.savedCommands.listSavedCommands, {
      sessionId,
      chatroomId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('User Cmd');
    expect(list[0].scope).toBe('user');
  });

  test("3. User-scoped command does NOT appear for a different user's chatroom", async () => {
    const userA = await setupUser('user-a');
    const userB = await setupUser('user-b');

    // User A creates a user-scoped command in their chatroom
    await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId: userA.sessionId,
      chatroomId: userA.chatroomId,
      command: { type: 'prompt', scope: 'user', name: 'UserA Cmd', prompt: 'Secret' },
    });

    // User B lists commands in their own chatroom — should not see UserA's user-scoped command
    const listB = await t.query(api.savedCommands.listSavedCommands, {
      sessionId: userB.sessionId,
      chatroomId: userB.chatroomId,
    });
    expect(listB).toHaveLength(0);
  });

  test('4. Duplicate name rejected within same scope; allowed across scopes', async () => {
    const { sessionId, chatroomId } = await setupUser('dup-test');

    // Create chatroom-scoped command named "test"
    await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'chatroom', name: 'test', prompt: 'first' },
    });

    // Same name in same scope should fail
    await expect(
      t.mutation(api.savedCommands.createSavedCommand, {
        sessionId,
        chatroomId,
        command: { type: 'prompt', scope: 'chatroom', name: 'test', prompt: 'second' },
      })
    ).rejects.toThrow();

    // Same name in different scope should succeed
    const cmdId = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'user', name: 'test', prompt: 'user version' },
    });
    expect(cmdId).toBeDefined();

    const list = await t.query(api.savedCommands.listSavedCommands, {
      sessionId,
      chatroomId,
    });
    expect(list).toHaveLength(2);
  });

  test("5. User cannot delete another user's user-scoped command", async () => {
    const userA = await setupUser('delete-a');

    // User A creates a user-scoped command
    const cmdId = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId: userA.sessionId,
      chatroomId: userA.chatroomId,
      command: { type: 'prompt', scope: 'user', name: 'UserA Cmd', prompt: 'Secret' },
    });

    // User B tries to delete it (User B has different session)
    const userB = await setupUser('delete-b');
    await expect(
      t.mutation(api.savedCommands.deleteSavedCommand, {
        sessionId: userB.sessionId,
        commandId: cmdId,
      })
    ).rejects.toThrow();
  });

  test('6. Scope cannot be changed on update', async () => {
    const { sessionId, chatroomId } = await setupUser('scope-immutable');

    // Create chatroom-scoped command
    const cmdId = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'chatroom', name: 'Original', prompt: 'test' },
    });

    // Update the command — scope is not in the update args, so it should stay
    await t.mutation(api.savedCommands.updateSavedCommand, {
      sessionId,
      commandId: cmdId,
      name: 'Updated Name',
    });

    const list = await t.query(api.savedCommands.listSavedCommands, {
      sessionId,
      chatroomId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Updated Name');
    expect(list[0].scope).toBe('chatroom');
  });

  test('7. updateSavedCommand rejects duplicate rename within same scope', async () => {
    const { sessionId, chatroomId } = await setupUser('dup-rename');

    // Create two distinct commands
    const cmd1 = await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'chatroom', name: 'First', prompt: 'first' },
    });
    await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId,
      chatroomId,
      command: { type: 'prompt', scope: 'chatroom', name: 'Second', prompt: 'second' },
    });

    // Rename cmd1 to "Second" should fail (duplicate in chatroom scope)
    await expect(
      t.mutation(api.savedCommands.updateSavedCommand, {
        sessionId,
        commandId: cmd1,
        name: 'Second',
      })
    ).rejects.toThrow();
  });

  test('8. createSavedCommand rejects empty prompt', async () => {
    const { sessionId, chatroomId } = await setupUser('empty-prompt');

    // Empty prompt after trim
    await expect(
      t.mutation(api.savedCommands.createSavedCommand, {
        sessionId,
        chatroomId,
        command: { type: 'prompt', scope: 'chatroom', name: 'Empty', prompt: '   ' },
      })
    ).rejects.toThrow();

    // Fully empty string
    await expect(
      t.mutation(api.savedCommands.createSavedCommand, {
        sessionId,
        chatroomId,
        command: { type: 'prompt', scope: 'chatroom', name: 'Empty2', prompt: '' },
      })
    ).rejects.toThrow();
  });

  test('9. User-scoped command appears in all chatrooms owned by the user', async () => {
    const user = await setupUser('multi-chatroom');

    // Create a second chatroom owned by the same user
    const chatroomB = await t.mutation(api.chatrooms.create, {
      sessionId: user.sessionId,
      teamId: 'solo',
      teamName: 'Solo',
      teamRoles: ['user'],
      teamEntryPoint: 'user',
    });

    await t.mutation(api.savedCommands.createSavedCommand, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      command: { type: 'prompt', scope: 'user', name: 'Global', prompt: 'everywhere' },
    });

    // Should appear in the second chatroom too
    const listB = await t.query(api.savedCommands.listSavedCommands, {
      sessionId: user.sessionId,
      chatroomId: chatroomB,
    });
    expect(listB).toHaveLength(1);
    expect(listB[0].name).toBe('Global');
  });

  test('10. Legacy command without scope field appears in list as chatroom-scoped', async () => {
    const { sessionId, chatroomId, userId } = await setupUser('legacy-scope');

    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_savedCommands', {
        chatroomId,
        createdAt: FIXED_NOW,
        createdBy: userId,
        name: 'Legacy Cmd',
        prompt: 'Before scope existed',
        type: 'prompt',
        updatedAt: FIXED_NOW,
      });
    });
    expect(legacyId).toBeDefined();

    const list = await t.query(api.savedCommands.listSavedCommands, {
      sessionId,
      chatroomId,
    });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Legacy Cmd');
    expect(list[0].scope).toBe('chatroom');

    await expect(
      t.mutation(api.savedCommands.createSavedCommand, {
        sessionId,
        chatroomId,
        command: { type: 'prompt', scope: 'chatroom', name: 'Legacy Cmd', prompt: 'duplicate' },
      })
    ).rejects.toThrow();
  });
});
