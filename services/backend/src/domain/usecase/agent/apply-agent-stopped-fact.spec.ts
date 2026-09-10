import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { applyAgentStopCommand } from './apply-agent-stop-command';
import { applyAgentStoppedFact } from './apply-agent-stopped-fact';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

let n = 0;

async function setupRoom(options: {
  roles: string[];
  machineId: string;
  pids: Record<string, number>;
}) {
  n += 1;
  const tag = `stopped-fact-${n}`;
  const sessionId = `${tag}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId: options.machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  for (const role of options.roles) {
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role,
      type: 'remote',
      machineId: options.machineId,
      agentHarness: 'opencode',
    });
  }
  await t.run(async (ctx) => {
    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    for (const config of configs) {
      const pid = options.pids[config.role];
      if (pid !== undefined) await ctx.db.patch(config._id, { spawnedAgentPid: pid });
    }
  });
  return { chatroomId };
}

async function createStop(chatroomId: Id<'chatroom_rooms'>, machineId?: string) {
  return t.run(async (ctx) =>
    applyAgentStopCommand(ctx, {
      chatroomId,
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
      selectedConfigs: await selectConfigsForAgentStop(
        ctx,
        machineId
          ? { chatroomId, scope: { kind: 'chatroom' }, machineId }
          : { chatroomId, scope: { kind: 'chatroom' } }
      ),
    })
  );
}

async function getTargets(stopCommandId: Id<'chatroom_agentStopCommands'>) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_agentStopTargets')
      .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
      .collect()
  );
}

async function getExecution(stopCommandId: Id<'chatroom_agentStopCommands'>, machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_agentStopMachineExecutions')
      .withIndex('by_stopCommandId_machineId', (q) =>
        q.eq('stopCommandId', stopCommandId).eq('machineId', machineId)
      )
      .unique()
  );
}

describe('applyAgentStoppedFact', () => {
  test('matches by intent id + machine + normalized role + exact PID', async () => {
    const machineId = `fact-match-m-${Date.now()}-${n}`;
    const { chatroomId } = await setupRoom({
      roles: ['builder'],
      machineId,
      pids: { builder: 7101 },
    });
    const { stopCommandId } = await createStop(chatroomId);
    const result = await t.run(async (ctx) =>
      applyAgentStoppedFact(ctx, {
        machineId,
        fact: {
          eventId: 'agent.stopped:cmd:room:builder',
          intentId: String(stopCommandId),
          commandId: 'inbox-1',
          machineId,
          chatroomId,
          role: '  Builder ',
          pid: 7101,
          outcome: 'stopped',
          reason: 'user.stop',
          occurredAt: 5000,
        },
      })
    );
    expect(result).toEqual({ success: true, applied: true });
    const targets = await getTargets(stopCommandId);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.status).toBe('completed');
    expect(targets[0]?.outcome).toBe('stopped');
    expect(targets[0]?.completedAt).toBe(5000);
    expect(targets[0]?.termination).toBeUndefined();
  });

  test('already_stopped completes with absent termination', async () => {
    const machineId = `fact-absent-m-${Date.now()}-${n}`;
    const { chatroomId } = await setupRoom({
      roles: ['builder'],
      machineId,
      pids: { builder: 7201 },
    });
    const { stopCommandId } = await createStop(chatroomId);
    const result = await t.run(async (ctx) =>
      applyAgentStoppedFact(ctx, {
        machineId,
        fact: {
          eventId: 'agent.stopped:cmd:room:builder',
          intentId: String(stopCommandId),
          commandId: 'inbox-2',
          machineId,
          chatroomId,
          role: 'builder',
          pid: 7201,
          outcome: 'already_stopped',
          reason: 'user.stop',
          occurredAt: 6000,
        },
      })
    );
    expect(result).toEqual({ success: true, applied: true });
    const targets = await getTargets(stopCommandId);
    expect(targets[0]?.outcome).toBe('already_stopped');
    expect(targets[0]?.termination).toBe('absent');
  });

  test('duplicate fact is a no-op after the first application', async () => {
    const machineId = `fact-dupe-m-${Date.now()}-${n}`;
    const { chatroomId } = await setupRoom({
      roles: ['builder'],
      machineId,
      pids: { builder: 7301 },
    });
    const { stopCommandId } = await createStop(chatroomId);
    const fact = {
      eventId: 'agent.stopped:cmd:room:builder',
      intentId: String(stopCommandId),
      commandId: 'inbox-3',
      machineId,
      chatroomId,
      role: 'builder',
      pid: 7301,
      outcome: 'stopped' as const,
      reason: 'user.stop' as const,
      occurredAt: 7000,
    };
    expect(await t.run((ctx) => applyAgentStoppedFact(ctx, { machineId, fact }))).toEqual({
      success: true,
      applied: true,
    });
    expect(await t.run((ctx) => applyAgentStoppedFact(ctx, { machineId, fact }))).toEqual({
      success: true,
      applied: false,
    });
    const targets = await getTargets(stopCommandId);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.status).toBe('completed');
  });

  test('unknown and mismatched facts are no-ops', async () => {
    const machineId = `fact-mismatch-m-${Date.now()}-${n}`;
    const { chatroomId } = await setupRoom({
      roles: ['builder'],
      machineId,
      pids: { builder: 7401 },
    });
    const { stopCommandId } = await createStop(chatroomId);
    const base = {
      eventId: 'e',
      intentId: String(stopCommandId),
      commandId: 'inbox-4',
      machineId,
      chatroomId,
      role: 'builder',
      pid: 7401,
      outcome: 'stopped' as const,
      reason: 'user.stop' as const,
      occurredAt: 8000,
    };
    // Unknown command.
    expect(
      await t.run((ctx) =>
        applyAgentStoppedFact(ctx, {
          machineId,
          fact: { ...base, intentId: String(chatroomId) },
        })
      )
    ).toEqual({ success: true, applied: false });
    // Wrong chatroom.
    const otherRoom = await t.run(async (ctx) => {
      const user = (await ctx.db.query('users').first())!;
      return await ctx.db.insert('chatroom_rooms', { status: 'active', ownerId: user._id });
    });
    expect(
      await t.run((ctx) =>
        applyAgentStoppedFact(ctx, {
          machineId,
          fact: { ...base, chatroomId: otherRoom },
        })
      )
    ).toEqual({ success: true, applied: false });
    // Wrong machine.
    expect(
      await t.run((ctx) =>
        applyAgentStoppedFact(ctx, {
          machineId: 'other-machine',
          fact: { ...base, machineId: 'other-machine' },
        })
      )
    ).toEqual({ success: true, applied: false });
    // Unknown target role.
    expect(
      await t.run((ctx) =>
        applyAgentStoppedFact(ctx, { machineId, fact: { ...base, role: 'planner' } })
      )
    ).toEqual({ success: true, applied: false });
    // Wrong PID.
    expect(
      await t.run((ctx) => applyAgentStoppedFact(ctx, { machineId, fact: { ...base, pid: 9999 } }))
    ).toEqual({ success: true, applied: false });
    // Nothing mutated.
    const targets = await getTargets(stopCommandId);
    expect(targets[0]?.status).toBe('pending');
  });

  test('multi-target execution stays processing until all facts arrive, then rolls up', async () => {
    const machineId = `fact-multi-m-${Date.now()}-${n}`;
    const { chatroomId } = await setupRoom({
      roles: ['builder', 'planner'],
      machineId,
      pids: { builder: 7501, planner: 7502 },
    });
    const { stopCommandId } = await createStop(chatroomId);
    const first = {
      eventId: 'agent.stopped:cmd:room:builder',
      intentId: String(stopCommandId),
      commandId: 'inbox-5',
      machineId,
      chatroomId,
      role: 'builder',
      pid: 7501,
      outcome: 'stopped' as const,
      reason: 'user.stop' as const,
      occurredAt: 9000,
    };
    expect(await t.run((ctx) => applyAgentStoppedFact(ctx, { machineId, fact: first }))).toEqual({
      success: true,
      applied: true,
    });
    let execution = await getExecution(stopCommandId, machineId);
    expect(execution?.status).not.toBe('completed');
    let command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', stopCommandId));
    expect(command?.status).not.toBe('completed');

    const second = {
      eventId: 'agent.stopped:cmd:room:planner',
      intentId: String(stopCommandId),
      commandId: 'inbox-6',
      machineId,
      chatroomId,
      role: 'planner',
      pid: 7502,
      outcome: 'stopped' as const,
      reason: 'user.stop' as const,
      occurredAt: 9001,
    };
    expect(await t.run((ctx) => applyAgentStoppedFact(ctx, { machineId, fact: second }))).toEqual({
      success: true,
      applied: true,
    });
    execution = await getExecution(stopCommandId, machineId);
    expect(execution?.status).toBe('completed');
    command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', stopCommandId));
    expect(command?.status).toBe('completed');
    const targets = await getTargets(stopCommandId);
    expect(targets.every((target) => target.status === 'completed')).toBe(true);
  });
});
