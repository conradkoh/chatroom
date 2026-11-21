import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  projectAgentRoleStatusReadModel,
  statusEventForAgentEvent,
  touchAgentRoleStatusLastSeen,
} from './project-agent-role-status-read-model';
import type { StatusEvent } from './project-agent-role-status-read-model';
import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { AgentStartReasonCode } from '../../entities/agent';

describe('statusEventForAgentEvent', () => {
  test('maps task.acknowledged to working so online agents show active work, not starting', () => {
    expect(statusEventForAgentEvent('task.acknowledged')).toEqual({ status: 'working' });
  });

  test('keeps agent boot events on starting', () => {
    expect(statusEventForAgentEvent('agent.requestStart')).toEqual({ status: 'starting' });
    expect(statusEventForAgentEvent('agent.started')).toEqual({ status: 'starting' });
  });
});

describe('projectAgentRoleStatusReadModel', () => {
  test('projects config and active task without a participant row', async () => {
    const sessionId = 'role-status-projection' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      await recordLastSentLaunchRequest(ctx, {
        requestId: 'role-status-request',
        commandId: 'role-status-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'enhancer',
        agentType: 'remote',
        machineId: 'configured-machine',
        agentHarness: 'opencode-sdk',
        model: 'test',
        workingDir: '/tmp',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
        requestedBy: user!._id,
        requestedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'enhance',
        assignedTo: 'enhancer',
        status: 'in_progress',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'enhancer',
        event: { status: 'working' },
      });
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(row?.machineId).toBe('configured-machine');
    expect(row?.activeWork?.kind).toBe('task');
    expect(row?.lastSeenAt).toBeUndefined();

    await t.run((ctx) =>
      touchAgentRoleStatusLastSeen(ctx, { chatroomId, role: 'enhancer', lastSeenAt: 123 })
    );
    const touched = await t.run((ctx) => ctx.db.get('chatroom_agentRoleStatusReadModel', row!._id));
    expect(touched?.lastSeenAt).toBe(123);
  });

  test('projects acknowledged task as working with activeWork', async () => {
    const sessionId = 'role-status-acknowledged' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'build it',
        assignedTo: 'builder',
        status: 'acknowledged',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    await t.run(async (ctx) => {
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: statusEventForAgentEvent('task.acknowledged'),
      });
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(row?.status).toBe('working');
    expect(row?.activeWork).toEqual({ kind: 'task', id: taskId });
  });

  test('accepts newer daemon observations and ignores duplicates, stale events, and other machines', async () => {
    const sessionId = 'role-status-ordering' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    await t.run(async (ctx) => {
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'waiting' },
        sourceMachineId: 'machine-a',
        sourceEventAt: 200,
        sourceRevisionKey: 'event:200',
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'error', errorSource: 'runtime', errorCode: 'stale' },
        sourceMachineId: 'machine-a',
        sourceEventAt: 100,
        sourceRevisionKey: 'event:100',
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'error', errorSource: 'runtime', errorCode: 'duplicate' },
        sourceMachineId: 'machine-a',
        sourceEventAt: 200,
        sourceRevisionKey: 'event:200',
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'error', errorSource: 'runtime', errorCode: 'wrong-machine' },
        sourceMachineId: 'machine-b',
        sourceEventAt: 300,
        sourceRevisionKey: 'event:300',
      });
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(row?.status).toBe('waiting');
    expect(row?.lastEventAt).toBe(200);
    expect(row?.revisionKey).toBe('event:200');
    expect(row?.machineId).toBe('machine-a');
  });
});

describe('terminal drop observability', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupRoom(sessionId: string) {
    await t.mutation(api.auth.loginAnon, { sessionId: sessionId as any });
    return await t.mutation(api.chatrooms.create, {
      sessionId: sessionId as any,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
  }

  // Seed rows through the projection itself, not by direct insert.
  function projectBuilder(
    chatroomId: Id<'chatroom_rooms'>,
    event: StatusEvent,
    source: { machineId: string; eventAt: number; revisionKey?: string | undefined }
  ) {
    return t.run((ctx) =>
      projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event,
        sourceMachineId: source.machineId,
        sourceEventAt: source.eventAt,
        ...(source.revisionKey !== undefined ? { sourceRevisionKey: source.revisionKey } : {}),
      })
    );
  }

  function rowOf(chatroomId: Id<'chatroom_rooms'>) {
    return t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
  }

  test('stale error is dropped, leaves the row unchanged, and warns once', async () => {
    const chatroomId = await setupRoom('terminal-drop-stale-error');
    await projectBuilder(
      chatroomId,
      { status: 'waiting' },
      { machineId: 'machine-a', eventAt: 200, revisionKey: 'event:200' }
    );

    const result = await projectBuilder(
      chatroomId,
      { status: 'error', errorSource: 'runtime', errorCode: 'stale' },
      { machineId: 'machine-a', eventAt: 100, revisionKey: 'event:100' }
    );

    expect(result).toEqual({ applied: false, reason: 'stale_event' });
    const row = await rowOf(chatroomId);
    expect(row?.status).toBe('waiting');
    expect(row?.lastEventAt).toBe(200);
    expect(row?.error).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents] dropped terminal role status',
      expect.objectContaining({
        reason: 'stale_event',
        status: 'error',
        chatroomId,
        role: 'builder',
        machineId: 'machine-a',
        sourceEventAt: 100,
        lastEventAt: 200,
        deltaMs: 100,
      })
    );
  });

  test('stale offline drop warns once with the event delta', async () => {
    const chatroomId = await setupRoom('terminal-drop-stale-offline');
    await projectBuilder(
      chatroomId,
      { status: 'waiting' },
      { machineId: 'machine-a', eventAt: 200, revisionKey: 'event:200' }
    );

    const result = await projectBuilder(
      chatroomId,
      { status: 'offline' },
      { machineId: 'machine-a', eventAt: 50, revisionKey: 'event:50' }
    );

    expect(result).toEqual({ applied: false, reason: 'stale_event' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents] dropped terminal role status',
      expect.objectContaining({
        reason: 'stale_event',
        status: 'offline',
        chatroomId,
        role: 'builder',
        machineId: 'machine-a',
        sourceEventAt: 50,
        lastEventAt: 200,
        deltaMs: 150,
      })
    );
  });

  test('a dropped working heartbeat stays silent', async () => {
    const chatroomId = await setupRoom('terminal-drop-working');
    await projectBuilder(
      chatroomId,
      { status: 'waiting' },
      { machineId: 'machine-a', eventAt: 200, revisionKey: 'event:200' }
    );

    const result = await projectBuilder(
      chatroomId,
      { status: 'working' },
      { machineId: 'machine-a', eventAt: 100, revisionKey: 'event:100' }
    );

    expect(result).toEqual({ applied: false, reason: 'stale_event' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('an applied terminal status stays silent', async () => {
    const chatroomId = await setupRoom('terminal-drop-applied');
    await projectBuilder(
      chatroomId,
      { status: 'waiting' },
      { machineId: 'machine-a', eventAt: 200, revisionKey: 'event:200' }
    );

    const result = await projectBuilder(
      chatroomId,
      { status: 'error', errorSource: 'runtime', errorCode: 'boom' },
      { machineId: 'machine-a', eventAt: 300, revisionKey: 'event:300' }
    );

    expect(result).toEqual({ applied: true });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a terminal status from another machine warns once and leaves heartbeats silent', async () => {
    const chatroomId = await setupRoom('terminal-drop-machine-mismatch');
    await projectBuilder(
      chatroomId,
      { status: 'waiting' },
      { machineId: 'machine-a', eventAt: 200, revisionKey: 'event:200' }
    );

    const terminal = await projectBuilder(
      chatroomId,
      { status: 'error', errorSource: 'runtime', errorCode: 'wrong-machine' },
      { machineId: 'machine-b', eventAt: 300, revisionKey: 'event:300' }
    );

    expect(terminal).toEqual({ applied: false, reason: 'machine_mismatch' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents] dropped terminal role status',
      expect.objectContaining({
        reason: 'machine_mismatch',
        status: 'error',
        chatroomId,
        role: 'builder',
        machineId: 'machine-b',
        sourceEventAt: 300,
        lastEventAt: 200,
        deltaMs: -100,
      })
    );

    const heartbeat = await projectBuilder(
      chatroomId,
      { status: 'working' },
      { machineId: 'machine-b', eventAt: 400, revisionKey: 'event:400' }
    );
    expect(heartbeat).toEqual({ applied: false, reason: 'machine_mismatch' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a terminal status for a missing room warns once and leaves heartbeats silent', async () => {
    const chatroomId = await setupRoom('terminal-drop-room-missing');
    await t.run((ctx) => ctx.db.delete('chatroom_rooms', chatroomId));

    const terminal = await projectBuilder(
      chatroomId,
      { status: 'error', errorSource: 'runtime', errorCode: 'gone' },
      { machineId: 'machine-a', eventAt: 300, revisionKey: 'event:300' }
    );

    expect(terminal).toEqual({ applied: false, reason: 'room_missing' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[agents] dropped terminal role status',
      expect.objectContaining({
        reason: 'room_missing',
        status: 'error',
        chatroomId,
        role: 'builder',
        machineId: 'machine-a',
        sourceEventAt: 300,
        lastEventAt: undefined,
        deltaMs: undefined,
      })
    );

    const heartbeat = await projectBuilder(
      chatroomId,
      { status: 'working' },
      { machineId: 'machine-a', eventAt: 400, revisionKey: 'event:400' }
    );
    expect(heartbeat).toEqual({ applied: false, reason: 'room_missing' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
