/**
 * Tests for hasActiveAgents logic in listWorkspacesForMachine use case.
 *
 * Since the use case depends on Convex QueryCtx, we test through a mock context
 * that simulates the db.query chain.
 */

import { describe, it, expect } from 'vitest';

import { isActiveParticipant, PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { listWorkspacesForMachine } from './list-workspaces-for-machine';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockParticipant(overrides: {
  role: string;
  lastSeenAction?: string | null;
  chatroomId?: string;
}) {
  return {
    _id: `participant_${Math.random().toString(36).slice(2)}`,
    chatroomId: overrides.chatroomId ?? 'chatroom_1',
    role: overrides.role,
    lastSeenAction: overrides.lastSeenAction ?? undefined,
  };
}

function createMockWorkspace(overrides: {
  chatroomId?: string;
  machineId?: string;
  removedAt?: number;
}) {
  const id = `ws_${Math.random().toString(36).slice(2)}`;
  return {
    _id: id,
    chatroomId: overrides.chatroomId ?? 'chatroom_1',
    machineId: overrides.machineId ?? 'machine_1',
    workingDir: '/test/dir',
    hostname: 'test-host',
    registeredAt: Date.now(),
    registeredBy: 'user_1',
    removedAt: overrides.removedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockCtx(workspaces: any[], participants: any[]): any {
  return {
    db: {
      query: (table: string) => {
        const data = table === 'chatroom_workspaces' ? workspaces : participants;
        return {
          withIndex: (_indexName: string, _filterFn?: (q: any) => any) => ({
            collect: async () => {
              // Simulate index filtering
              if (table === 'chatroom_workspaces' && _filterFn) {
                // Filter by machineId
                const captured: { field?: string; value?: string } = {};
                const q = {
                  eq: (field: string, value: string) => {
                    captured.field = field;
                    captured.value = value;
                    return q;
                  },
                };
                _filterFn(q);
                if (captured.field === 'machineId') {
                  return data.filter((d: any) => d.machineId === captured.value);
                }
              }
              if (table === 'chatroom_participants' && _filterFn) {
                // Filter by chatroomId
                const captured: { field?: string; value?: string } = {};
                const q = {
                  eq: (field: string, value: string) => {
                    captured.field = field;
                    captured.value = value;
                    return q;
                  },
                };
                _filterFn(q);
                if (captured.field === 'chatroomId') {
                  return data.filter((d: any) => d.chatroomId === captured.value);
                }
              }
              return data;
            },
          }),
        };
      },
    },
  };
}

// ─── isActiveParticipant entity tests ──────────────────────────────────────

describe('isActiveParticipant', () => {
  it('returns true for participant with no lastSeenAction', () => {
    expect(isActiveParticipant({})).toBe(true);
  });

  it('returns true for participant with non-exited action', () => {
    expect(isActiveParticipant({ lastSeenAction: 'get-next-task:started' })).toBe(true);
  });

  it('returns false for exited participant', () => {
    expect(isActiveParticipant({ lastSeenAction: PARTICIPANT_EXITED_ACTION })).toBe(false);
    expect(isActiveParticipant({ lastSeenAction: 'exited' })).toBe(false);
  });
});

// ─── listWorkspacesForMachine — hasActiveAgents ────────────────────────────

describe('listWorkspacesForMachine — hasActiveAgents', () => {
  it('returns hasActiveAgents=false when chatroom has no participants', async () => {
    const ws = createMockWorkspace({ machineId: 'machine_1', chatroomId: 'chatroom_1' });
    const ctx = createMockCtx([ws], []);

    const result = await listWorkspacesForMachine(ctx, { machineId: 'machine_1' });

    expect(result).toHaveLength(1);
    expect(result[0].hasActiveAgents).toBe(false);
  });

  it('returns hasActiveAgents=false when all participants are exited', async () => {
    const ws = createMockWorkspace({ machineId: 'machine_1', chatroomId: 'chatroom_1' });
    const participants = [
      createMockParticipant({
        role: 'builder',
        lastSeenAction: 'exited',
        chatroomId: 'chatroom_1',
      }),
      createMockParticipant({
        role: 'planner',
        lastSeenAction: 'exited',
        chatroomId: 'chatroom_1',
      }),
    ];
    const ctx = createMockCtx([ws], participants);

    const result = await listWorkspacesForMachine(ctx, { machineId: 'machine_1' });

    expect(result).toHaveLength(1);
    expect(result[0].hasActiveAgents).toBe(false);
  });

  it('returns hasActiveAgents=false when only user participants are active', async () => {
    const ws = createMockWorkspace({ machineId: 'machine_1', chatroomId: 'chatroom_1' });
    const participants = [
      createMockParticipant({
        role: 'user',
        lastSeenAction: 'get-next-task:started',
        chatroomId: 'chatroom_1',
      }),
    ];
    const ctx = createMockCtx([ws], participants);

    const result = await listWorkspacesForMachine(ctx, { machineId: 'machine_1' });

    expect(result).toHaveLength(1);
    expect(result[0].hasActiveAgents).toBe(false);
  });

  it('returns hasActiveAgents=true when active non-user participants exist', async () => {
    const ws = createMockWorkspace({ machineId: 'machine_1', chatroomId: 'chatroom_1' });
    const participants = [
      createMockParticipant({
        role: 'builder',
        lastSeenAction: 'get-next-task:started',
        chatroomId: 'chatroom_1',
      }),
      createMockParticipant({
        role: 'user',
        lastSeenAction: undefined,
        chatroomId: 'chatroom_1',
      }),
    ];
    const ctx = createMockCtx([ws], participants);

    const result = await listWorkspacesForMachine(ctx, { machineId: 'machine_1' });

    expect(result).toHaveLength(1);
    expect(result[0].hasActiveAgents).toBe(true);
  });

  it('excludes removed workspaces', async () => {
    const activeWs = createMockWorkspace({ machineId: 'machine_1', chatroomId: 'chatroom_1' });
    const removedWs = createMockWorkspace({
      machineId: 'machine_1',
      chatroomId: 'chatroom_2',
      removedAt: Date.now(),
    });
    const ctx = createMockCtx([activeWs, removedWs], []);

    const result = await listWorkspacesForMachine(ctx, { machineId: 'machine_1' });

    expect(result).toHaveLength(1);
    expect(result[0].chatroomId).toBe('chatroom_1');
  });
});
