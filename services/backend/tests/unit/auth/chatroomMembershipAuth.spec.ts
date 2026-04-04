/**
 * Unit tests for chatroom membership authorization.
 *
 * Tests the pure `checkChatroomMembershipForMachine` function
 * using injected mock dependencies (no real DB needed).
 */

import { describe, expect, test } from 'vitest';

import {
  checkChatroomMembershipForMachine,
  type ChatroomMembershipDeps,
  type ChatroomRef,
  type WorkspaceRef,
} from '../../../src/domain/usecase/auth/extensions/chatroom-membership';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockDeps(
  workspaces: WorkspaceRef[],
  chatrooms: ChatroomRef[]
): ChatroomMembershipDeps {
  return {
    getWorkspacesForMachine: async (machineId: string) =>
      workspaces.filter((w) => w.machineId === machineId),
    getChatroom: async (chatroomId: string) =>
      chatrooms.find((c) => c._id === chatroomId) ?? null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('checkChatroomMembershipForMachine', () => {
  test('grants access when user owns a chatroom the machine is registered in', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'chatroom-1', machineId: 'machine-1' }],
      [{ _id: 'chatroom-1', ownerId: 'user-1' }]
    );

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result).toEqual({ authorized: true, chatroomId: 'chatroom-1' });
  });

  test('denies access when user does not own any chatroom the machine is in', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'chatroom-1', machineId: 'machine-1' }],
      [{ _id: 'chatroom-1', ownerId: 'other-user' }]
    );

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result.authorized).toBe(false);
  });

  test('denies access when machine has no workspace registrations', async () => {
    const deps = createMockDeps([], []);

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result).toEqual({
      authorized: false,
      reason: 'Machine has no workspace registrations',
    });
  });

  test('grants access when user owns one of multiple chatrooms', async () => {
    const deps = createMockDeps(
      [
        { chatroomId: 'chatroom-1', machineId: 'machine-1' },
        { chatroomId: 'chatroom-2', machineId: 'machine-1' },
      ],
      [
        { _id: 'chatroom-1', ownerId: 'other-user' },
        { _id: 'chatroom-2', ownerId: 'user-1' },
      ]
    );

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result).toEqual({ authorized: true, chatroomId: 'chatroom-2' });
  });

  test('handles missing chatroom gracefully', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'deleted-chatroom', machineId: 'machine-1' }],
      [] // chatroom not found
    );

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result.authorized).toBe(false);
  });

  test('deduplicates chatroom IDs from multiple workspaces', async () => {
    let getChatroomCallCount = 0;
    const deps: ChatroomMembershipDeps = {
      getWorkspacesForMachine: async () => [
        { chatroomId: 'chatroom-1', machineId: 'machine-1' },
        { chatroomId: 'chatroom-1', machineId: 'machine-1' }, // duplicate
        { chatroomId: 'chatroom-1', machineId: 'machine-1' }, // duplicate
      ],
      getChatroom: async (chatroomId: string) => {
        getChatroomCallCount++;
        return { _id: chatroomId, ownerId: 'user-1' };
      },
    };

    const result = await checkChatroomMembershipForMachine(deps, 'machine-1', 'user-1');
    expect(result.authorized).toBe(true);
    // Should only query each chatroom once despite 3 workspace registrations
    expect(getChatroomCallCount).toBe(1);
  });

  test('works with different machines in the same chatroom', async () => {
    const deps = createMockDeps(
      [
        { chatroomId: 'chatroom-1', machineId: 'machine-1' },
        { chatroomId: 'chatroom-1', machineId: 'machine-2' },
      ],
      [{ _id: 'chatroom-1', ownerId: 'user-1' }]
    );

    // machine-2 is in a chatroom owned by user-1
    const result = await checkChatroomMembershipForMachine(deps, 'machine-2', 'user-1');
    expect(result).toEqual({ authorized: true, chatroomId: 'chatroom-1' });
  });
});
