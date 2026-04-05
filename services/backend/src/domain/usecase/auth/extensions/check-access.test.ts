import { describe, it, expect } from 'vitest';
import {
  checkAccess,
  requireAccess,
  type CheckAccessDeps,
  type Accessor,
  type Resource,
  type Permission,
} from './check-access';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const USER_A: Accessor = { type: 'user', id: 'user-a' };

function createMockDeps(overrides: Partial<CheckAccessDeps> = {}): CheckAccessDeps {
  return {
    getMachineByMachineId: async () => null,
    getChatroom: async () => null,
    getWorkspacesForMachine: async () => [],
    ...overrides,
  };
}

// ─── Machine + Owner ────────────────────────────────────────────────────────

describe('checkAccess — machine + owner', () => {
  const resource: Resource = { type: 'machine', id: 'machine-1' };
  const permission: Permission = 'owner';

  it('grants access when user owns the machine', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'owner' });
  });

  it('denies access when user does not own the machine', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'user-b' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('do not own');
    }
  });

  it('denies access when machine not found', async () => {
    const deps = createMockDeps();

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: false, reason: 'Machine not found' });
  });
});

// ─── Machine + Write-Access ─────────────────────────────────────────────────

describe('checkAccess — machine + write-access', () => {
  const resource: Resource = { type: 'machine', id: 'machine-1' };
  const permission: Permission = 'write-access';

  it('grants access when user owns a chatroom the machine is in', async () => {
    const deps = createMockDeps({
      getWorkspacesForMachine: async () => [{ chatroomId: 'chat-1', machineId: 'machine-1' }],
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  it('denies access when user does not own any chatroom the machine is in', async () => {
    const deps = createMockDeps({
      getWorkspacesForMachine: async () => [{ chatroomId: 'chat-1', machineId: 'machine-1' }],
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-b' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
  });

  it('denies access when machine has no workspace registrations', async () => {
    const deps = createMockDeps();

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: false, reason: 'Machine has no workspace registrations' });
  });

  it('grants access when user owns one of multiple chatrooms', async () => {
    const deps = createMockDeps({
      getWorkspacesForMachine: async () => [
        { chatroomId: 'chat-1', machineId: 'machine-1' },
        { chatroomId: 'chat-2', machineId: 'machine-1' },
      ],
      getChatroom: async (id) => {
        if (id === 'chat-1') return { id: 'chat-1', ownerId: 'user-b' };
        if (id === 'chat-2') return { id: 'chat-2', ownerId: 'user-a' };
        return null;
      },
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  it('handles missing chatroom gracefully', async () => {
    const deps = createMockDeps({
      getWorkspacesForMachine: async () => [{ chatroomId: 'chat-gone', machineId: 'machine-1' }],
      getChatroom: async () => null,
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
  });

  it('grants access when user is machine owner (even without chatroom membership)', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });
});

// ─── Machine + Read-Access ──────────────────────────────────────────────────

describe('checkAccess — machine + read-access', () => {
  const resource: Resource = { type: 'machine', id: 'machine-1' };
  const permission: Permission = 'read-access';

  it('grants access via chatroom membership', async () => {
    const deps = createMockDeps({
      getWorkspacesForMachine: async () => [{ chatroomId: 'chat-1', machineId: 'machine-1' }],
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  it('denies access when no chatroom membership', async () => {
    const deps = createMockDeps();

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
  });

  it('grants access when user is machine owner (even without chatroom membership)', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'read-access' });
  });
});

// ─── Chatroom + Owner ───────────────────────────────────────────────────────

describe('checkAccess — chatroom + owner', () => {
  const resource: Resource = { type: 'chatroom', id: 'chat-1' };
  const permission: Permission = 'owner';

  it('grants access when user owns the chatroom', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'owner' });
  });

  it('denies access when user does not own the chatroom', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-b' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('do not own');
    }
  });

  it('denies access when chatroom not found', async () => {
    const deps = createMockDeps();

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: false, reason: 'Chatroom not found' });
  });
});

// ─── Chatroom + Write-Access ────────────────────────────────────────────────

describe('checkAccess — chatroom + write-access', () => {
  const resource: Resource = { type: 'chatroom', id: 'chat-1' };
  const permission: Permission = 'write-access';

  it('grants access (same as owner for now)', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  it('denies access when user does not own chatroom', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-b' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
  });
});

// ─── Chatroom + Read-Access ─────────────────────────────────────────────────

describe('checkAccess — chatroom + read-access', () => {
  const resource: Resource = { type: 'chatroom', id: 'chat-1' };
  const permission: Permission = 'read-access';

  it('grants access (same as owner for now)', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result).toEqual({ ok: true, permission: 'read-access' });
  });

  it('denies access when user does not own chatroom', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-b' }),
    });

    const result = await checkAccess(deps, { accessor: USER_A, resource, permission });
    expect(result.ok).toBe(false);
  });
});

// ─── requireAccess ──────────────────────────────────────────────────────────

describe('requireAccess', () => {
  it('returns permission when access is granted', async () => {
    const deps = createMockDeps({
      getChatroom: async () => ({ id: 'chat-1', ownerId: 'user-a' }),
    });

    const result = await requireAccess(deps, {
      accessor: USER_A,
      resource: { type: 'chatroom', id: 'chat-1' },
      permission: 'owner',
    });
    expect(result).toEqual({ permission: 'owner' });
  });

  it('throws ConvexError when access is denied', async () => {
    const deps = createMockDeps();

    await expect(
      requireAccess(deps, {
        accessor: USER_A,
        resource: { type: 'chatroom', id: 'chat-1' },
        permission: 'owner',
      })
    ).rejects.toThrow('Chatroom not found');
  });
});
