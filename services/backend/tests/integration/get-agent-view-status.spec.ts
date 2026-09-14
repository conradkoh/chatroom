import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { projectAgentRoleStatusReadModel } from '../../src/domain/usecase/agent/project-agent-role-status-read-model';
import { transitionAgentStatus } from '../../src/domain/usecase/agent/transition-agent-status';
import { getAgentViewStatus } from '../../src/domain/usecase/chatroom/get-agent-view-status';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
} from '../helpers/integration';

async function query(chatroomId: Id<'chatroom_rooms'>) {
  const ownerId = await t.run(
    async (ctx) => (await ctx.db.get('chatroom_rooms', chatroomId))!.ownerId
  );
  return t.run((ctx) => getAgentViewStatus(ctx, { chatroomId, userId: ownerId }));
}

describe('getAgentViewStatus', () => {
  test('returns all roles stopped for a fresh team', async () => {
    const { sessionId } = await createTestSession('view-fresh');
    const room = await createDuoTeamChatroom(sessionId as any);
    const result = await query(room);
    expect(result?.agents.map((a) => a.state)).toEqual(['stopped', 'stopped', 'stopped']);
  });

  test('returns running from the projection', async () => {
    const { sessionId } = await createTestSession('view-running');
    const machineId = 'view-running-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, room, 'builder', 123);
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.state).toBe('running');
  });

  test('returns starting from an in-flight participant status', async () => {
    const { sessionId } = await createTestSession('view-starting');
    const machineId = 'view-starting-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.run((ctx) => transitionAgentStatus(ctx, room, 'builder', 'agent.requestStart'));
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.state).toBe('starting');
  });

  test('rejects a non-owner', async () => {
    const first = await createTestSession('view-owner');
    const room = await createDuoTeamChatroom(first.sessionId as any);
    await createTestSession('view-other');
    const otherUser = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('users')
            .filter((q) => q.eq(q.field('email'), 'view-other@example.com'))
            .first()
        )?._id
    );
    expect(
      await t.run((ctx) => getAgentViewStatus(ctx, { chatroomId: room, userId: otherUser! }))
    ).toBeNull();
  });
});

describe('getAgentViewStatus — fresh team', () => {
  test('returns all team roles stopped', async () => {
    const { sessionId } = await createTestSession('view-fresh-3role');
    const result = await query(await createDuoTeamChatroom(sessionId as any));
    expect(result!.teamRoles).toEqual(['planner', 'enhancer', 'builder']);
    expect(result!.agents).toHaveLength(3);
    expect(result!.agents.every((a) => a.state === 'stopped')).toBe(true);
  });
});

describe('getAgentViewStatus — running and stopped', () => {
  test('returns running state with machine name', async () => {
    const { sessionId } = await createTestSession('view-running-name');
    const machineId = 'view-running-name-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, room, 'builder', 12345);
    const builder = (await query(room))!.agents.find((a) => a.role === 'builder');
    expect(builder?.state).toBe('running');
    expect(builder?.machineName).toBe('test-host');
  });
  test('returns stopped after stop command', async () => {
    const { sessionId } = await createTestSession('view-stopped');
    const machineId = 'view-stopped-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — daemon status is machine-scoped', () => {
  test('does not rewrite role state when daemon disconnects with PID', async () => {
    const { sessionId } = await createTestSession('view-disconn-pid');
    const machineId = 'view-disconn-pid-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, room, 'builder', 88888);
    await t.mutation(api.machines.markDaemonOffline, {
      sessionId: sessionId as any,
      machineId,
    });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('running');
  });
  test('does not rewrite role state when daemon disconnects without PID', async () => {
    const { sessionId } = await createTestSession('view-disconn-none');
    const machineId = 'view-disconn-none-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.machines.markDaemonOffline, {
      sessionId: sessionId as any,
      machineId,
    });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — daemon restart cleanup', () => {
  test('returns stopped after clearing PIDs', async () => {
    const { sessionId } = await createTestSession('view-restart');
    const machineId = 'view-restart-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, room, 'builder', 12345);
    await t.run((ctx) =>
      projectAgentRoleStatusReadModel(ctx, {
        chatroomId: room,
        role: 'builder',
        event: { status: 'offline' },
        sourceMachineId: machineId,
        clearObservedPid: true,
      })
    );
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — circuit breaker', () => {
  test('returns circuit_open when tripped', async () => {
    const { sessionId } = await createTestSession('view-circuit');
    const machineId = 'view-circuit-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.run((ctx) =>
      projectAgentRoleStatusReadModel(ctx, {
        chatroomId: room,
        role: 'builder',
        event: {
          status: 'error',
          errorSource: 'runtime',
          errorCode: 'circuit_open',
          errorMessage: 'Circuit breaker open',
        },
        sourceMachineId: machineId,
      })
    );
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe(
      'circuit_open'
    );
  });
});

describe('getAgentViewStatus — stale roles', () => {
  test('excludes roles removed from current team', async () => {
    const { sessionId } = await createTestSession('view-stale');
    const machineId = 'view-stale-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId: room,
      teamStructureId: 'solo@1',
    });
    const result = await query(room);
    expect(result!.agents).toHaveLength(2);
    expect(result!.agents.map((a) => a.role)).toEqual(['solo', 'enhancer']);
  });
});

describe('getAgentViewStatus — history', () => {
  test('reports history from chatroom messages', async () => {
    const { sessionId } = await createTestSession('view-history-projection');
    const room = await createDuoTeamChatroom(sessionId as any);
    expect((await query(room))?.hasHistory).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId: room,
        senderRole: 'assistant',
        content: 'progress',
        type: 'progress',
      });
    });
    expect((await query(room))?.hasHistory).toBe(true);
  });
});

describe('getAgentViewStatus — decoy isolation', () => {
  test('resolves the assigned machine name with unrelated machines present', async () => {
    const { sessionId } = await createTestSession('view-decoy-isolation');
    const target = 'view-decoy-target';
    await registerMachineWithDaemon(sessionId as any, target);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, target, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, target, room, 'builder', 12345);
    for (let i = 0; i < 5; i++)
      await registerMachineWithDaemon(sessionId as any, `view-decoy-${i}`);
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.machineName).toBe(
      'test-host'
    );
  });
});
