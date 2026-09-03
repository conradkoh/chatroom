// fallow-ignore-file code-duplication complexity
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { ackMachineOperationalSignals } from './ack-machine-operational-signals';
import { writeMachineOperationalSignal } from './write-machine-operational-signal';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function setup(label: string) {
  const sessionId = `ack-operational-${label}-${Math.random()}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return { chatroomId, machineId: `ack-machine-${label}`, sessionId };
}

function key(timestamp: number, chatroomId: string, role = 'builder'): string {
  return `${String(timestamp).padStart(16, '0')}:${chatroomId}:${role}`;
}

async function writeSignals(
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  count: number,
  start = 100
): Promise<void> {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await writeMachineOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: `role-${index}`,
        revisionKey: `revision-${index}`,
        projectedAt: start + index,
      });
    }
  });
}

describe('ackMachineOperationalSignals', () => {
  test('deletes delivered signals and preserves later signals', async () => {
    const { chatroomId, machineId } = await setup('range');
    await writeSignals(machineId, chatroomId, 3);
    const result = await t.run((ctx) =>
      ackMachineOperationalSignals(ctx, {
        machineId,
        throughSignalKey: key(101, String(chatroomId), 'role-1'),
      })
    );
    expect(result).toEqual({ deletedCount: 2, hasMore: false });
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(remaining.map((row) => row.signalKey)).toEqual([key(102, String(chatroomId), 'role-2')]);
  });

  test('reconciles the head after acknowledging a signal range', async () => {
    const { chatroomId, machineId } = await setup('head');
    await writeSignals(machineId, chatroomId, 3);
    await t.run((ctx) =>
      ackMachineOperationalSignals(ctx, {
        machineId,
        throughSignalKey: key(101, String(chatroomId), 'role-1'),
      })
    );
    const head = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignalHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect(head?.latestSignal.signalKey).toBe(key(102, String(chatroomId), 'role-2'));
    expect(head?.previousSignalKey).toBeUndefined();
  });

  test('deletes the head when no signals remain and is idempotent', async () => {
    const { chatroomId, machineId } = await setup('empty');
    await writeSignals(machineId, chatroomId, 1);
    const throughSignalKey = key(100, String(chatroomId), 'role-0');
    await t.run((ctx) => ackMachineOperationalSignals(ctx, { machineId, throughSignalKey }));
    const emptyHead = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignalHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect(emptyHead).toBeNull();
    await expect(
      t.run((ctx) => ackMachineOperationalSignals(ctx, { machineId, throughSignalKey }))
    ).resolves.toEqual({ deletedCount: 0, hasMore: false });
  });

  test('does not delete signals after the requested cursor', async () => {
    const { chatroomId, machineId } = await setup('future');
    await writeSignals(machineId, chatroomId, 2);
    await t.run((ctx) =>
      ackMachineOperationalSignals(ctx, {
        machineId,
        throughSignalKey: key(99, String(chatroomId), 'role-0'),
      })
    );
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(remaining).toHaveLength(2);
  });

  test('limits a single ack to 100 rows and reports more work', async () => {
    const { chatroomId, machineId } = await setup('batch');
    await writeSignals(machineId, chatroomId, 101);
    const result = await t.run((ctx) =>
      ackMachineOperationalSignals(ctx, {
        machineId,
        throughSignalKey: key(200, String(chatroomId), 'role-100'),
      })
    );
    expect(result).toEqual({ deletedCount: 100, hasMore: true });
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(remaining).toHaveLength(1);

    const continuation = await t.run((ctx) =>
      ackMachineOperationalSignals(ctx, {
        machineId,
        throughSignalKey: key(200, String(chatroomId), 'role-100'),
      })
    );
    expect(continuation).toEqual({ deletedCount: 1, hasMore: false });

    const finalState = await t.run(async (ctx) => ({
      signals: await ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect(),
      head: await ctx.db
        .query('chatroom_machineOperationalSignalHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first(),
    }));
    expect(finalState.signals).toHaveLength(0);
    expect(finalState.head).toBeNull();
  });
});
