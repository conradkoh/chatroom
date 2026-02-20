/**
 * Get Agent Status — Integration Tests
 *
 * Tests the `getAgentStatus` use case which is the single source of truth
 * for computing an agent's display status.
 *
 * Valid statuses differ by agent type:
 *
 *   Remote agents: offline, starting, ready, working, stopping, restarting, dead, dead_failed_revive
 *   Custom agents: offline, ready, working, dead
 *
 * Custom agents CANNOT be in: starting, stopping, restarting, dead_failed_revive
 * (these require daemon control which custom agents don't have)
 */

import { describe, expect, test } from 'vitest';

import {
  getAgentStatus,
  REMOTE_AGENT_STATUSES,
  CUSTOM_AGENT_STATUSES,
  type RemoteAgentDisplayStatus,
  type CustomAgentDisplayStatus,
} from '../../src/domain/usecase/agent/get-agent-status';
import { t } from '../../test.setup';
import { createPairTeamChatroom, createTestSession } from '../helpers/integration';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupChatroomWithParticipant(
  testId: string,
  opts: {
    agentType: 'remote' | 'custom';
    participantStatus?: string;
    readyUntil?: number;
    activeUntil?: number;
    desiredStatus?: 'running' | 'stopped';
    machineId?: string;
    pendingCommand?: 'start-agent' | 'stop-agent';
  }
) {
  const { sessionId } = await createTestSession(testId);
  const chatroomId = await createPairTeamChatroom(sessionId);

  await t.run(async (ctx) => {
    // Create team config
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: `team_${chatroomId}#role_builder`,
      chatroomId,
      role: 'builder',
      type: opts.agentType,
      machineId: opts.machineId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create participant if status provided
    if (opts.participantStatus) {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        status: opts.participantStatus as 'waiting',
        readyUntil: opts.readyUntil,
        activeUntil: opts.activeUntil,
      });
    }

    // Create desired state if provided
    if (opts.desiredStatus) {
      await ctx.db.insert('chatroom_machineAgentDesiredState', {
        chatroomId,
        role: 'builder',
        desiredStatus: opts.desiredStatus,
        requestedAt: Date.now(),
        requestedBy: 'user',
        machineId: opts.machineId,
      });
    }

    // Create pending command if provided
    if (opts.pendingCommand && opts.machineId) {
      const userId = await ctx.db.insert('users', {
        type: 'anonymous',
        name: 'test-user-status',
        accessLevel: 'user',
      });
      await ctx.db.insert('chatroom_machineCommands', {
        machineId: opts.machineId,
        type: opts.pendingCommand,
        payload: { chatroomId, role: 'builder' },
        status: 'pending',
        sentBy: userId,
        createdAt: Date.now(),
      });
    }
  });

  return chatroomId;
}

// ─── Valid Status Sets ───────────────────────────────────────────────────────

describe('getAgentStatus — valid status sets', () => {
  test('remote agents have 8 valid statuses including daemon-controlled transitions', () => {
    expect(REMOTE_AGENT_STATUSES).toEqual([
      'offline',
      'starting',
      'ready',
      'working',
      'stopping',
      'restarting',
      'dead',
      'dead_failed_revive',
    ]);
  });

  test('custom agents have 4 valid statuses (no daemon-controlled transitions)', () => {
    expect(CUSTOM_AGENT_STATUSES).toEqual(['offline', 'ready', 'working', 'dead']);
  });

  test('custom agents CANNOT be in starting, stopping, restarting, or dead_failed_revive', () => {
    const customSet = new Set<string>(CUSTOM_AGENT_STATUSES);
    const daemonOnlyStatuses = ['starting', 'stopping', 'restarting', 'dead_failed_revive'];

    for (const status of daemonOnlyStatuses) {
      expect(customSet.has(status), `Custom agents should not have "${status}" status`).toBe(false);
    }
  });
});

// ─── Remote Agent Status Resolution ──────────────────────────────────────────

describe('getAgentStatus — remote agents', () => {
  test('no participant → offline', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r1', {
      agentType: 'remote',
      machineId: 'machine-r1',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('offline');
  });

  test('no participant + desired=running + pending start → starting', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r2', {
      agentType: 'remote',
      machineId: 'machine-r2',
      desiredStatus: 'running',
      pendingCommand: 'start-agent',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('starting');
    expect(result.hasPendingCommand).toBe(true);
  });

  test('waiting + not expired → ready', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r3', {
      agentType: 'remote',
      machineId: 'machine-r3',
      participantStatus: 'waiting',
      readyUntil: Date.now() + 60_000,
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('ready');
    expect(result.isExpired).toBe(false);
  });

  test('active + not expired → working', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r4', {
      agentType: 'remote',
      machineId: 'machine-r4',
      participantStatus: 'active',
      activeUntil: Date.now() + 60_000,
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('working');
  });

  test('waiting + desired=stopped → stopping', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r5', {
      agentType: 'remote',
      machineId: 'machine-r5',
      participantStatus: 'waiting',
      readyUntil: Date.now() + 60_000,
      desiredStatus: 'stopped',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('stopping');
    expect(result.desiredStatus).toBe('stopped');
  });

  test('waiting + expired → dead', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r6', {
      agentType: 'remote',
      machineId: 'machine-r6',
      participantStatus: 'waiting',
      readyUntil: Date.now() - 10_000, // expired
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('dead');
    expect(result.isExpired).toBe(true);
  });

  test('expired + desired=running + pending start → restarting', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r7', {
      agentType: 'remote',
      machineId: 'machine-r7',
      participantStatus: 'waiting',
      readyUntil: Date.now() - 10_000, // expired
      desiredStatus: 'running',
      pendingCommand: 'start-agent',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('restarting');
    expect(result.isExpired).toBe(true);
    expect(result.hasPendingCommand).toBe(true);
  });

  test('participant status = restarting → restarting', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r8', {
      agentType: 'remote',
      machineId: 'machine-r8',
      participantStatus: 'restarting',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('restarting');
  });

  test('participant status = dead_failed_revive → dead_failed_revive', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-r9', {
      agentType: 'remote',
      machineId: 'machine-r9',
      participantStatus: 'dead_failed_revive',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('remote');
    expect(result.displayStatus).toBe('dead_failed_revive');
  });

  test('returns all valid remote statuses (type safety)', async () => {
    const validStatuses = new Set<string>(REMOTE_AGENT_STATUSES);
    const testedStatuses: RemoteAgentDisplayStatus[] = [
      'offline',
      'starting',
      'ready',
      'working',
      'stopping',
      'restarting',
      'dead',
      'dead_failed_revive',
    ];

    for (const status of testedStatuses) {
      expect(validStatuses.has(status), `"${status}" should be a valid remote status`).toBe(true);
    }
  });
});

// ─── Custom Agent Status Resolution ──────────────────────────────────────────

describe('getAgentStatus — custom agents', () => {
  test('no participant → offline', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c1', {
      agentType: 'custom',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('offline');
  });

  test('waiting + not expired → ready', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c2', {
      agentType: 'custom',
      participantStatus: 'waiting',
      readyUntil: Date.now() + 60_000,
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('ready');
  });

  test('active + not expired → working', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c3', {
      agentType: 'custom',
      participantStatus: 'active',
      activeUntil: Date.now() + 60_000,
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('working');
  });

  test('waiting + expired → dead', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c4', {
      agentType: 'custom',
      participantStatus: 'waiting',
      readyUntil: Date.now() - 10_000, // expired
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('dead');
    expect(result.isExpired).toBe(true);
  });

  // ─── Custom agents CANNOT be in daemon-controlled states ─────────────────

  test('participant status = restarting → maps to dead (not restarting)', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c5', {
      agentType: 'custom',
      participantStatus: 'restarting',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('dead');
    expect(result.displayStatus).not.toBe('restarting');
  });

  test('participant status = dead_failed_revive → maps to dead (not dead_failed_revive)', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c6', {
      agentType: 'custom',
      participantStatus: 'dead_failed_revive',
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).toBe('dead');
    expect(result.displayStatus).not.toBe('dead_failed_revive');
  });

  test('custom agent NEVER returns starting status', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c7', {
      agentType: 'custom',
      desiredStatus: 'running',
      // Even with desired=running and no participant, custom agent → offline (not starting)
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).not.toBe('starting');
    expect(result.displayStatus).toBe('offline');
  });

  test('custom agent NEVER returns stopping status', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-c8', {
      agentType: 'custom',
      participantStatus: 'waiting',
      readyUntil: Date.now() + 60_000,
      desiredStatus: 'stopped',
      // Even with desired=stopped and active participant, custom agent → ready (not stopping)
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.agentType).toBe('custom');
    expect(result.displayStatus).not.toBe('stopping');
    expect(result.displayStatus).toBe('ready');
  });

  test('all custom agent results have displayStatus in CUSTOM_AGENT_STATUSES', async () => {
    const validStatuses = new Set<string>(CUSTOM_AGENT_STATUSES);
    const testedStatuses: CustomAgentDisplayStatus[] = ['offline', 'ready', 'working', 'dead'];

    for (const status of testedStatuses) {
      expect(validStatuses.has(status), `"${status}" should be a valid custom status`).toBe(true);
    }

    // Verify daemon-only statuses are NOT in custom set
    const daemonOnly = ['starting', 'stopping', 'restarting', 'dead_failed_revive'];
    for (const status of daemonOnly) {
      expect(validStatuses.has(status), `"${status}" should NOT be a valid custom status`).toBe(
        false
      );
    }
  });
});

// ─── Status Reason ───────────────────────────────────────────────────────────

describe('getAgentStatus — statusReason', () => {
  test('every result includes a non-empty statusReason', async () => {
    const chatroomId = await setupChatroomWithParticipant('test-status-reason', {
      agentType: 'remote',
      machineId: 'machine-reason',
      participantStatus: 'waiting',
      readyUntil: Date.now() + 60_000,
    });

    const result = await t.run(async (ctx) => {
      return getAgentStatus(ctx, { chatroomId, role: 'builder' });
    });

    expect(result.statusReason).toBeTruthy();
    expect(typeof result.statusReason).toBe('string');
    expect(result.statusReason.length).toBeGreaterThan(0);
  });
});
