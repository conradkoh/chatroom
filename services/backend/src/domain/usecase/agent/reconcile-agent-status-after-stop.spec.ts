import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';

let n = 0;

async function setup() {
  const sessionId = `reconcile-stop-${++n}` as SessionId;
  const machineId = `reconcile-machine-${n}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode-sdk'],
  });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return { sessionId, machineId, chatroomId };
}
type Setup = Awaited<ReturnType<typeof setup>>;

// Seed rows directly. projectedAt: 1 is a sentinel: any projection patch sets projectedAt to Date.now(), so an untouched row keeps 1.
function seedRow(
  chatroomId: Id<'chatroom_rooms'>,
  row: Partial<Doc<'chatroom_agentRoleStatusReadModel'>> & {
    role: string;
    status: Doc<'chatroom_agentRoleStatusReadModel'>['status'];
  }
) {
  return t.run((ctx) =>
    ctx.db.insert('chatroom_agentRoleStatusReadModel', {
      chatroomId,
      roleKind: 'persistent',
      projectedAt: 1,
      ...row,
    })
  );
}

// Enqueue an agent.stop and claim it through the daemon inbox mutation so it is `processing`.
async function claimStop(s: Setup, scope: { role?: string; workingDir?: string } = {}) {
  const commandId = await t.run((ctx) =>
    enqueueMachineCommand(ctx, {
      machineId: s.machineId,
      command: { type: 'agent.stop', chatroomId: s.chatroomId, ...scope },
    })
  );
  const claimed = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
    sessionId: s.sessionId,
    machineId: s.machineId,
  });
  expect(claimed?.commandId).toBe(commandId);
  return commandId;
}

function shutdownFact(s: Setup, commandId: Id<'chatroom_machineCommandInbox'>, emittedAt: number) {
  return {
    kind: 'chatroom_shutdown_complete' as const,
    chatroomId: s.chatroomId,
    commandId,
    revisionKey: `shutdown:${commandId}`,
    emittedAt,
  };
}

function project(s: Setup, fact: ReturnType<typeof shutdownFact>, machineId = s.machineId) {
  return t.mutation(api.machines.projectAgentLifecycleFact, {
    sessionId: s.sessionId,
    machineId,
    fact,
  });
}

function rowsOf(chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function rowFor(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return (await rowsOf(chatroomId)).find((r) => r.role === role);
}

describe('reconcileAgentStatusAfterStop', () => {
  test('shutdown resets live rows owned by the machine', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 4242,
      lastEventAt: 1000,
    });
    await seedRow(s.chatroomId, {
      role: 'planner',
      status: 'working',
      machineId: s.machineId,
      observedPid: 4243,
      lastEventAt: 1000,
    });

    const cmd = await claimStop(s);
    const result = await project(s, shutdownFact(s, cmd, 2000));

    expect(result).toMatchObject({ success: true, reconciledRoleCount: 2 });

    const rows = await rowsOf(s.chatroomId);
    expect(rows).toHaveLength(2);
    for (const role of ['builder', 'planner']) {
      const row = rows.find((r) => r.role === role);
      expect(row?.status).toBe('offline');
      expect(row?.observedPid).toBeUndefined();
      expect(row?.lastEventAt).toBe(2000);
      expect(row?.projectedAt).not.toBe(1);
    }

    const command = await t.run((ctx) => ctx.db.get('chatroom_machineCommandInbox', cmd));
    expect(command).toBeNull();
  });

  test('newer rows, other machines, and rows without a pid are untouched', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'planner',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 1,
      lastEventAt: 3000,
    });
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'waiting',
      machineId: 'other-machine',
      observedPid: 2,
      lastEventAt: 1000,
    });
    await seedRow(s.chatroomId, {
      role: 'reviewer',
      status: 'error',
      machineId: s.machineId,
      lastEventAt: 1000,
      error: { source: 'runtime', code: 'x', message: 'x', occurredAt: 1 },
    });
    await seedRow(s.chatroomId, {
      role: 'enhancer',
      status: 'offline',
      machineId: s.machineId,
      lastEventAt: 1000,
    });

    const cmd = await claimStop(s);
    const result = await project(s, shutdownFact(s, cmd, 2000));

    expect(result).toMatchObject({ success: true, reconciledRoleCount: 0 });

    const rows = await rowsOf(s.chatroomId);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.projectedAt).toBe(1);
  });

  test('an error row that still holds an observedPid is reset', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'reviewer',
      status: 'error',
      machineId: s.machineId,
      observedPid: 7,
      lastEventAt: 1000,
      error: { source: 'runtime', code: 'x', message: 'x', occurredAt: 1 },
    });

    const cmd = await claimStop(s);
    await project(s, shutdownFact(s, cmd, 2000));

    const row = await rowFor(s.chatroomId, 'reviewer');
    expect(row?.status).toBe('offline');
    expect(row?.observedPid).toBeUndefined();
  });

  test('role scope resets only the named role', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 1,
      lastEventAt: 1000,
    });
    await seedRow(s.chatroomId, {
      role: 'planner',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 2,
      lastEventAt: 1000,
    });

    const cmd = await claimStop(s, { role: 'Builder' });
    const result = await project(s, shutdownFact(s, cmd, 2000));

    expect(result).toMatchObject({ success: true, reconciledRoleCount: 1 });
    expect((await rowFor(s.chatroomId, 'builder'))?.status).toBe('offline');
    const planner = await rowFor(s.chatroomId, 'planner');
    expect(planner?.status).toBe('waiting');
    expect(planner?.observedPid).toBe(2);
  });

  test('workspace scope matches working dir with a trailing-slash tolerant comparison', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'working',
      machineId: s.machineId,
      workingDir: '/w/a/',
      observedPid: 1,
      lastEventAt: 1000,
    });
    await seedRow(s.chatroomId, {
      role: 'planner',
      status: 'working',
      machineId: s.machineId,
      workingDir: '/w/b',
      observedPid: 2,
      lastEventAt: 1000,
    });
    await seedRow(s.chatroomId, {
      role: 'reviewer',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 3,
      lastEventAt: 1000,
    });

    const cmd = await claimStop(s, { workingDir: '/w/a' });
    const result = await project(s, shutdownFact(s, cmd, 2000));

    expect(result).toMatchObject({ success: true, reconciledRoleCount: 1 });
    expect((await rowFor(s.chatroomId, 'builder'))?.status).toBe('offline');
    expect((await rowFor(s.chatroomId, 'planner'))?.status).toBe('working');
    expect((await rowFor(s.chatroomId, 'reviewer'))?.status).toBe('waiting');
  });

  test('replay and a second stop-all are no-ops', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 1,
      lastEventAt: 1000,
    });

    const cmd1 = await claimStop(s);
    const first = await project(s, shutdownFact(s, cmd1, 2000));
    expect(first).toMatchObject({ success: true, reconciledRoleCount: 1 });
    const afterFirst = await rowFor(s.chatroomId, 'builder');

    const replay = await project(s, shutdownFact(s, cmd1, 2000));
    expect(replay).toEqual({
      success: true,
      skipped: true,
      rejectionReason: 'command_not_found',
    });
    expect((await rowFor(s.chatroomId, 'builder'))?.projectedAt).toBe(afterFirst?.projectedAt);

    const cmd2 = await claimStop(s);
    const second = await project(s, shutdownFact(s, cmd2, 3000));
    expect(second).toMatchObject({ success: true, reconciledRoleCount: 0 });
  });

  test('a start whose spawned fact is newer than the shutdown fact is never reset', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'working',
      machineId: s.machineId,
      observedPid: 9,
      lastEventAt: 3000,
    });

    const cmd = await claimStop(s);
    const result = await project(s, shutdownFact(s, cmd, 2000));

    expect(result).toMatchObject({ success: true, reconciledRoleCount: 0 });
    const row = await rowFor(s.chatroomId, 'builder');
    expect(row?.status).toBe('working');
    expect(row?.observedPid).toBe(9);
  });

  test('a command that is not processing is skipped', async () => {
    const s = await setup();
    await seedRow(s.chatroomId, {
      role: 'builder',
      status: 'waiting',
      machineId: s.machineId,
      observedPid: 1,
      lastEventAt: 1000,
    });

    // Enqueue only; do not claim, so the command stays `pending`.
    const cmd = await t.run((ctx) =>
      enqueueMachineCommand(ctx, {
        machineId: s.machineId,
        command: { type: 'agent.stop', chatroomId: s.chatroomId },
      })
    );

    const result = await project(s, shutdownFact(s, cmd, 2000));
    expect(result).toEqual({
      success: true,
      skipped: true,
      rejectionReason: 'command_not_processing',
    });
    expect((await rowFor(s.chatroomId, 'builder'))?.projectedAt).toBe(1);
  });
});
