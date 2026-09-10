/** Agent command inbox integration coverage. */
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { AGENT_STOP_REQUEST_DEADLINE_MS } from '../config/reliability';
import { enqueueAgentStopCommand } from '../src/domain/usecase/machine/enqueue-agent-stop-command';
import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

let machineId = 'agent-inbox-test-machine';
let chatroomId = '' as Id<'chatroom_rooms'>;
let n = 0;
async function owner() {
  const sessionId = `agent-inbox-session-owner-${++n}` as SessionId;
  machineId = `agent-inbox-test-machine-${n}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  chatroomId = await t.run(async (ctx) => {
    const user = (await ctx.db.query('users').first())!;
    return await ctx.db.insert('chatroom_rooms', {
      status: 'active',
      ownerId: user._id,
      name: `agent-inbox-room-${n}`,
    });
  });
  return sessionId;
}
async function stranger() {
  const sessionId = `agent-inbox-session-stranger-${n}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  return sessionId;
}
async function put(now = Date.now()) {
  return t.run((ctx) =>
    enqueueAgentStopCommand(ctx, {
      machineId,
      intentId: `intent-${machineId}-${now}`,
      chatroomId,
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
      now,
    })
  );
}
async function claim(sessionId: SessionId) {
  return t.mutation(api.daemon.agentCommandInbox.claimNext, { sessionId, machineId });
}

describe.sequential('daemon.agentCommandInbox', () => {
  test('watch empty returns null', async () => {
    const sessionId = await owner();
    expect(await t.query(api.daemon.agentCommandInbox.watchNext, { sessionId, machineId })).toEqual(
      { commandId: null }
    );
  });
  test('watch returns id', async () => {
    const sessionId = await owner();
    const id = await put();
    expect(
      (await t.query(api.daemon.agentCommandInbox.watchNext, { sessionId, machineId })).commandId
    ).toBe(id);
  });
  test('expired pending work is ignored', async () => {
    const sessionId = await owner();
    await put(Date.now() - 600_000);
    expect(
      (await t.query(api.daemon.agentCommandInbox.watchNext, { sessionId, machineId })).commandId
    ).toBeNull();
    expect(await claim(sessionId)).toBeNull();
  });
  test('claim returns the exact flattened agent.stop envelope', async () => {
    const sessionId = await owner();
    const now = Date.now();
    const id = await put(now);
    const result = await claim(sessionId);
    expect(result).toEqual({
      commandId: id,
      machineId,
      type: 'agent.stop',
      intentId: `intent-${machineId}-${now}`,
      chatroomId,
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
      timestamp: now,
      deadline: now + AGENT_STOP_REQUEST_DEADLINE_MS,
    });
  });
  test('second claim is null', async () => {
    const sessionId = await owner();
    await put();
    expect(await claim(sessionId)).not.toBeNull();
    expect(await claim(sessionId)).toBeNull();
  });
  test('renew is capped by deadline', async () => {
    const sessionId = await owner();
    await put();
    const row = await claim(sessionId);
    const renewed = await t.mutation(api.daemon.agentCommandInbox.renewClaim, {
      sessionId,
      commandId: row!.commandId,
    });
    expect(renewed.leaseExpiresAt).toBeLessThanOrEqual(row!.deadline);
  });
  test('acknowledge deletes the row and missing acknowledge is idempotent', async () => {
    const sessionId = await owner();
    await put();
    const row = await claim(sessionId);
    expect(
      await t.mutation(api.daemon.agentCommandInbox.acknowledge, {
        sessionId,
        commandId: row!.commandId,
      })
    ).toEqual({ deleted: true });
    expect(
      await t.mutation(api.daemon.agentCommandInbox.acknowledge, {
        sessionId,
        commandId: row!.commandId,
      })
    ).toEqual({ deleted: false });
  });
  test('wrong-session renew and ack are rejected', async () => {
    const sessionId = await owner();
    const other = await stranger();
    await put();
    const row = await claim(sessionId);
    await expect(
      t.mutation(api.daemon.agentCommandInbox.renewClaim, {
        sessionId: other,
        commandId: row!.commandId,
      })
    ).rejects.toThrow('NOT_AUTHORIZED_MACHINE');
    await expect(
      t.mutation(api.daemon.agentCommandInbox.acknowledge, {
        sessionId: other,
        commandId: row!.commandId,
      })
    ).rejects.toThrow('NOT_AUTHORIZED_MACHINE');
    expect(await t.run((ctx) => ctx.db.get(row!.commandId))).not.toBeNull();
  });
  test('recovery requeues live work and preserves command, times, and attempt count', async () => {
    const sessionId = await owner();
    const now = Date.now();
    const id = await put(now);
    await claim(sessionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { leaseExpiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.machineCommandCleanup.recoverExpiredClaims, {});
    const rows = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', machineId).eq('status', 'pending')
        )
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].attemptCount).toBe(1);
    expect(rows[0].createdAt).toBe(now);
    expect(rows[0].deadlineAt).toBe(now + AGENT_STOP_REQUEST_DEADLINE_MS);
    expect(rows[0].command).toEqual({
      type: 'agent.stop',
      intentId: `intent-${machineId}-${now}`,
      chatroomId,
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
    });
  });
  test('recovery deletes expired processing rows without requeueing', async () => {
    const sessionId = await owner();
    const id = await put();
    await claim(sessionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { leaseExpiresAt: Date.now() - 1, deadlineAt: Date.now() - 1 });
    });
    await t.mutation(internal.machineCommandCleanup.recoverExpiredClaims, {});
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
  test('cleanup deletes expired rows', async () => {
    const id = await put(Date.now() - 600_000);
    await t.mutation(internal.machineCommandCleanup.cleanupExpiredMachineCommands, {});
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
});
