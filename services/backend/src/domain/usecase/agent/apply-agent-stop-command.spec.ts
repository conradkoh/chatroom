/** Cutover coverage: agent stops enqueue dedicated agent.stop rows, not legacy stopScope rows. */
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { applyAgentStopCommand } from './apply-agent-stop-command';
import { createAgentStopCommand } from './create-agent-stop-command';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import { getInboxCommandsForMachine } from '../../../../tests/helpers/machine-command-inbox';

async function setupTwoMachineRoom(tag: string) {
  const sessionId = `apply-stop-${tag}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  const machines = [`apply-stop-${tag}-m1`, `apply-stop-${tag}-m2`];
  for (const machineId of machines) {
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
  }
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId,
    role: 'builder',
    type: 'remote',
    machineId: machines[0],
    agentHarness: 'opencode',
  });
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId,
    role: 'planner',
    type: 'remote',
    machineId: machines[1],
    agentHarness: 'opencode',
  });
  await t.run(async (ctx) => {
    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    for (const [index, config] of configs.entries()) {
      await ctx.db.patch(config._id, { spawnedAgentPid: 1000 + index, spawnedAt: Date.now() });
    }
  });
  return { chatroomId, machines };
}

async function dedicatedPendingRows(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_agentCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()
  );
}

describe('applyAgentStopCommand dedicated inbox cutover', () => {
  test('result uses agentCommandIdsByMachine with one dedicated row per machine', async () => {
    const { chatroomId, machines } = await setupTwoMachineRoom('fanout');
    const result = await t.run(async (ctx) =>
      applyAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'chatroom' },
        }),
      })
    );

    expect(Object.keys(result.agentCommandIdsByMachine).sort()).toEqual([...machines].sort());
    for (const machineId of machines) {
      const rows = await dedicatedPendingRows(machineId);
      expect(rows).toHaveLength(1);
      expect(rows[0]._id).toBe(result.agentCommandIdsByMachine[machineId]);
      expect(rows[0].command.type).toBe('agent.stop');
      expect(rows[0].command.intentId).toBe(String(result.stopCommandId));
      expect(rows[0].command.chatroomId).toBe(chatroomId);
      expect(rows[0].command.scope).toEqual({ kind: 'chatroom' });
      expect(rows[0].command.reason).toBe('user.stop');
      expect(Number.isFinite(rows[0].deadlineAt)).toBe(true);
      expect(rows[0].deadlineAt).toBeGreaterThan(Date.now());
    }
  });

  test('no legacy agent.stopScope row is written', async () => {
    const { chatroomId, machines } = await setupTwoMachineRoom('no-legacy');
    await t.run(async (ctx) =>
      applyAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'chatroom' },
        }),
      })
    );

    for (const machineId of machines) {
      expect(await getInboxCommandsForMachine(machineId, 'agent.stopScope')).toEqual([]);
    }
  });

  test('stop command, targets, and executions still exist without legacy inboxCommandId', async () => {
    const { chatroomId, machines } = await setupTwoMachineRoom('projections');
    const result = await t.run(async (ctx) =>
      applyAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'chatroom' },
        }),
      })
    );

    const command = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', result.stopCommandId)
    );
    expect(command?.status).toBe('pending');

    const targets = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', result.stopCommandId))
        .collect()
    );
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.pid).sort()).toEqual([1000, 1001]);

    const executions = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopMachineExecutions')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', result.stopCommandId))
        .collect()
    );
    expect(executions).toHaveLength(2);
    expect(executions.map((execution) => execution.machineId).sort()).toEqual([...machines].sort());
    for (const execution of executions) {
      expect(execution.status).toBe('pending');
      expect(execution).not.toHaveProperty('inboxCommandId');
    }
  });

  test('superseding stop deletes the pending dedicated row for the prior stop', async () => {
    const { chatroomId, machines } = await setupTwoMachineRoom('supersede');
    const first = await t.run(async (ctx) =>
      applyAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'chatroom' },
        }),
      })
    );
    const second = await t.run(async (ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'agent', role: 'builder' },
          machineId: machines[0],
        }),
      })
    );

    expect(second.stopCommandId).not.toBe(first.stopCommandId);
    const superseded = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', first.stopCommandId)
    );
    expect(superseded?.status).toBe('superseded');

    for (const machineId of machines) {
      const rows = await dedicatedPendingRows(machineId);
      expect(rows.filter((row) => row.command.intentId === String(first.stopCommandId))).toEqual(
        []
      );
    }
    const secondRows = await dedicatedPendingRows(machines[0]!);
    expect(
      secondRows.filter((row) => row.command.intentId === String(second.stopCommandId)).length
    ).toBeGreaterThan(0);

    const firstTargets = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', first.stopCommandId))
        .collect()
    );
    for (const target of firstTargets) expect(target.status).toBe('superseded');
  });
});
