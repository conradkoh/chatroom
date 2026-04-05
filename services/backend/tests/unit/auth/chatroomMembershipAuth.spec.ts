/**
 * Unit tests for chatroom membership authorization.
 *
 * Tests the unified `checkAccess` function for machine write-access
 * (which checks chatroom membership) using injected mock dependencies.
 *
 * Migrated from the old `checkChatroomMembershipForMachine` tests.
 */

import { describe, expect, test } from 'vitest';

import {
  checkAccess,
  type CheckAccessDeps,
  type Accessor,
  type Resource,
} from '../../../src/domain/usecase/auth/extensions/check-access';

// ─── Test Helpers ───────────────────────────────────────────────────────────

interface ChatroomRef {
  id: string;
  ownerId: string;
}

interface WorkspaceRef {
  chatroomId: string;
  machineId: string;
}

function createMockDeps(
  workspaces: WorkspaceRef[],
  chatrooms: ChatroomRef[]
): CheckAccessDeps {
  return {
    getMachineByMachineId: async () => null,
    getWorkspacesForMachine: async (machineId: string) =>
      workspaces.filter((w) => w.machineId === machineId),
    getChatroom: async (chatroomId: string) =>
      chatrooms.find((c) => c.id === chatroomId) ?? null,
  };
}

const USER_1: Accessor = { type: 'user', id: 'user-1' };
const MACHINE_1: Resource = { type: 'machine', id: 'machine-1' };

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('checkAccess — machine write-access (chatroom membership)', () => {
  test('grants access when user owns a chatroom the machine is registered in', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'chatroom-1', machineId: 'machine-1' }],
      [{ id: 'chatroom-1', ownerId: 'user-1' }]
    );

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  test('denies access when user does not own any chatroom the machine is in', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'chatroom-1', machineId: 'machine-1' }],
      [{ id: 'chatroom-1', ownerId: 'other-user' }]
    );

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result.ok).toBe(false);
  });

  test('denies access when machine has no workspace registrations', async () => {
    const deps = createMockDeps([], []);

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result).toEqual({
      ok: false,
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
        { id: 'chatroom-1', ownerId: 'other-user' },
        { id: 'chatroom-2', ownerId: 'user-1' },
      ]
    );

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  test('handles missing chatroom gracefully', async () => {
    const deps = createMockDeps(
      [{ chatroomId: 'deleted-chatroom', machineId: 'machine-1' }],
      [] // chatroom not found
    );

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result.ok).toBe(false);
  });

  test('deduplicates chatroom IDs from multiple workspaces', async () => {
    let getChatroomCallCount = 0;
    const deps: CheckAccessDeps = {
      getMachineByMachineId: async () => null,
      getWorkspacesForMachine: async () => [
        { chatroomId: 'chatroom-1', machineId: 'machine-1' },
        { chatroomId: 'chatroom-1', machineId: 'machine-1' }, // duplicate
        { chatroomId: 'chatroom-1', machineId: 'machine-1' }, // duplicate
      ],
      getChatroom: async (chatroomId: string) => {
        getChatroomCallCount++;
        return { id: chatroomId, ownerId: 'user-1' };
      },
    };

    const result = await checkAccess(deps, { accessor: USER_1, resource: MACHINE_1, permission: 'write-access' });
    expect(result.ok).toBe(true);
    // Should only query each chatroom once despite 3 workspace registrations
    expect(getChatroomCallCount).toBe(1);
  });

  test('works with different machines in the same chatroom', async () => {
    const deps = createMockDeps(
      [
        { chatroomId: 'chatroom-1', machineId: 'machine-1' },
        { chatroomId: 'chatroom-1', machineId: 'machine-2' },
      ],
      [{ id: 'chatroom-1', ownerId: 'user-1' }]
    );

    const machine2: Resource = { type: 'machine', id: 'machine-2' };
    const result = await checkAccess(deps, { accessor: USER_1, resource: machine2, permission: 'write-access' });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });
});
