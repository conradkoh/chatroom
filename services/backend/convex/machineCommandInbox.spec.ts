/** Machine command inbox integration coverage. */
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';
import { t } from '../test.setup';
import { api, internal } from './_generated/api';

let machineId = 'inbox-test-machine';
let n = 0;
async function owner() {
  const sessionId = 'inbox-session-owner' as SessionId;
  machineId = `inbox-test-machine-${++n}`;
  await t.mutation(api.auth.loginAnon, { sessionId });
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  return sessionId;
}
async function put(now = Date.now()) {
  return t.run((ctx) =>
    enqueueMachineCommand(ctx, { machineId, now, command: { type: 'daemon.ping' } })
  );
}

describe.sequential('daemon.machineCommandInbox', () => {
  test('watch empty returns null', async () => {
    const sessionId = await owner();
    expect(
      await t.query(api.daemon.machineCommandInbox.watchNext, { sessionId, machineId })
    ).toEqual({ commandId: null });
  });
  test('watch returns id', async () => {
    const sessionId = await owner();
    const id = await put();
    expect(
      (await t.query(api.daemon.machineCommandInbox.watchNext, { sessionId, machineId })).commandId
    ).toBe(id);
  });
  test('watch ignores expired', async () => {
    const sessionId = await owner();
    await put(Date.now() - 600_000);
    expect(
      (await t.query(api.daemon.machineCommandInbox.watchNext, { sessionId, machineId })).commandId
    ).toBeNull();
  });
  test('claim flattens payload', async () => {
    const sessionId = await owner();
    await put();
    const result = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    expect(result).toMatchObject({ machineId, type: 'daemon.ping' });
  });
  test('second claim differs', async () => {
    const sessionId = await owner();
    await put();
    const first = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    const second = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
  test('ack deletes row', async () => {
    const sessionId = await owner();
    await put();
    const row = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    expect(
      await t.mutation(api.daemon.machineCommandInbox.acknowledge, {
        sessionId,
        commandId: row!.commandId,
      })
    ).toEqual({ deleted: true });
  });
  test('renew is capped by deadline', async () => {
    const sessionId = await owner();
    await put();
    const row = await t.mutation(api.daemon.machineCommandInbox.claimNext, {
      sessionId,
      machineId,
    });
    const renewed = await t.mutation(api.daemon.machineCommandInbox.renewClaim, {
      sessionId,
      commandId: row!.commandId,
    });
    expect(renewed.leaseExpiresAt).toBeLessThanOrEqual(row!.deadline);
  });
  test('recover requeues expired lease', async () => {
    const sessionId = await owner();
    const id = await put();
    await t.mutation(api.daemon.machineCommandInbox.claimNext, { sessionId, machineId });
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { leaseExpiresAt: Date.now() - 1 });
    });
    await t.mutation(internal.machineCommandCleanup.recoverExpiredClaims, {});
    const rows = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', machineId).eq('status', 'pending')
        )
        .collect()
    );
    expect(rows.length).toBeGreaterThan(0);
  });
  test('cleanup deletes expired rows', async () => {
    const id = await put(Date.now() - 600_000);
    await t.mutation(internal.machineCommandCleanup.cleanupExpiredMachineCommands, {});
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
});
