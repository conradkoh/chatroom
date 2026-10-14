/**
 * Integration tests for scheduled prompts.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getInboxCommandsForMachine } from '../tests/helpers/machine-command-inbox';
import { TEST_MODEL_OPENCODE } from '../tests/helpers/test-models';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerPrimaryWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'planner',
  });
  await t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
    sessionId,
    chatroomId,
    workspaceId,
  });
  return workspaceId;
}

async function saveRoleConfig(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  workspaceId: Id<'chatroom_workspaces'>,
  machineId: string,
  role: string
): Promise<void> {
  await t.mutation(api.agents.saveConfig, {
    sessionId,
    chatroomId,
    workspaceId,
    role,
    machineId,
    agentHarness: 'opencode',
    model: TEST_MODEL_OPENCODE,
    workingDir: '/tmp/test',
  });
}

/**
 * Registers a machine + primary workspace, saves config for every role, and
 * projects the given status for each role. Defaults to `offline` (wakeable).
 */
async function setupWakeableAgents(args: {
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  roles: string[];
  statuses?: Record<string, 'offline' | 'waiting' | 'working' | 'error' | 'stopping'> | undefined;
}): Promise<Id<'chatroom_workspaces'>> {
  const { sessionId, chatroomId, machineId, roles } = args;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  const workspaceId = await registerPrimaryWorkspace(sessionId, chatroomId, machineId, '/tmp/test');
  for (const role of roles) {
    await saveRoleConfig(sessionId, chatroomId, workspaceId, machineId, role);
  }
  await t.run(async (ctx) => {
    for (const role of roles) {
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role,
        roleKind: 'persistent',
        status: args.statuses?.[role] ?? 'offline',
        machineId,
        workspaceId,
        projectedAt: Date.now(),
      });
    }
  });
  return workspaceId;
}

async function seedOverduePrompt(
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>,
  prompt = 'scheduled message'
): Promise<Id<'chatroom_scheduledPrompts'>> {
  const now = Date.now();
  return await t.run(async (ctx) =>
    ctx.db.insert('chatroom_scheduledPrompts', {
      chatroomId,
      prompt,
      scheduleKind: 'interval',
      intervalMinutes: 30,
      disabledReason: undefined,
      isRunnable: true,
      nextRunAt: now - 1000, // overdue
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
  );
}

describe('scheduled prompts', () => {
  test('create validates minimum interval', async () => {
    const { sessionId } = await createTestSession('sp-min-interval');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.scheduledPrompts.create, {
        sessionId,
        chatroomId,
        prompt: 'daily standup',
        scheduleKind: 'interval',
        intervalMinutes: 0,
      })
    ).rejects.toThrow();
  });

  test('setEnabled(false) sets isRunnable: false and clears nextRunAt', async () => {
    const { sessionId } = await createTestSession('sp-set-enabled');
    const chatroomId = await createChatroom(sessionId);

    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'daily standup',
      scheduleKind: 'daily',
      hourUTC: 9,
      minuteUTC: 0,
    });

    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: false,
    });

    const row = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>);
    });
    expect(row).toBeDefined();
    expect(row!.isRunnable).toBe(false);
    expect(row!.nextRunAt).toBeUndefined();
    expect(row!.disabledReason).toBe('user');
  });

  test('setEnabled(true) on archive-held row throws LIFECYCLE_DISABLED', async () => {
    const { sessionId, userId } = await createTestSession('sp-archive-hold');
    const chatroomId = await createChatroom(sessionId);

    // Seed a prompt row with disabledReason: 'archive'
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'archived prompt',
        scheduleKind: 'daily',
        hourUTC: 10,
        minuteUTC: 0,
        disabledReason: 'archive',
        isRunnable: false,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
        enabled: true,
      })
    ).rejects.toThrow();
  });

  test('fireOne sends message with sourcePlatform scheduled and creates task', async () => {
    const { sessionId, userId } = await createTestSession('sp-fire-one');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'scheduled message',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now - 1000, // overdue
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, {
      scheduledPromptId: id,
    });

    // Verify a message was created with sourcePlatform: 'scheduled'
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages.find((m) => m.sourcePlatform === 'scheduled');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('scheduled message');
    expect(msg!.senderRole).toBe('user');
    expect(msg!.taskId).toBeDefined();

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', msg!.taskId!));
    expect(task?.startInNewSession).toBe(true);

    // Verify prompt row has updated nextRunAt
    const row = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>);
    });
    expect(row).toBeDefined();
    expect(row!.lastRunAt).toBeGreaterThanOrEqual(now);
    expect(row!.nextRunAt).toBeGreaterThan(now);
  });

  test('fireOne creates message with scheduledPromptId and sourcePlatform', async () => {
    const { sessionId, userId } = await createTestSession('sp-fire-one-link');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'linked scheduled message',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now - 1000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, {
      scheduledPromptId: id,
    });

    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages.find((m) => m.sourcePlatform === 'scheduled');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('linked scheduled message');
    expect(msg!.sourcePlatform).toBe('scheduled');
    expect(msg!.scheduledPromptId).toBe(id);
  });

  test('listTriggeredMessages returns messages linked to prompt, ordered desc', async () => {
    const { sessionId, userId } = await createTestSession('sp-list-triggered');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'list test prompt',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Insert two messages linked to the prompt (no createdAt — uses _creationTime)
    await Promise.all([
      t.run(async (ctx) => {
        await ctx.db.insert('chatroom_messages', {
          chatroomId,
          senderRole: 'user',
          content: 'first',
          type: 'message',
          scheduledPromptId: id,
        });
      }),
      // Small delay so _creationTime order differs
      new Promise((r) => setTimeout(r, 5)),
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'second',
        type: 'message',
        scheduledPromptId: id,
      });
    });

    const result = await t.query(api.scheduledPrompts.listTriggeredMessages, {
      sessionId,
      scheduledPromptId: id,
      limit: 10,
    });

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('second');
    expect(result[1].content).toBe('first');
  });

  test('listTriggeredMessages access denied for wrong session', async () => {
    const { sessionId, userId } = await createTestSession('sp-list-denied');
    const { sessionId: otherSession } = await createTestSession('sp-list-denied-other');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'denied prompt',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.query(api.scheduledPrompts.listTriggeredMessages, {
        sessionId: otherSession,
        scheduledPromptId: id,
      })
    ).rejects.toThrow();
  });

  test('fireOne sets nextRunAt from scheduled anchor not execution time', async () => {
    const { sessionId, userId } = await createTestSession('sp-anchor');
    const chatroomId = await createChatroom(sessionId);

    const scheduledAt = Date.now() - 5000;
    const intervalMs = 60_000;
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'anchor test',
        scheduleKind: 'interval',
        intervalMinutes: 1,
        isRunnable: true,
        nextRunAt: scheduledAt,
        createdBy: userId,
        createdAt: scheduledAt,
        updatedAt: scheduledAt,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.nextRunAt).toBe(scheduledAt + intervalMs);
    expect(row!.nextRunAt).toBeLessThan(Date.now() + intervalMs - 4000);
  });

  test('setEnabled(true) preserves interval cadence from lastRunAt', async () => {
    const { sessionId } = await createTestSession('sp-reenable');
    const chatroomId = await createChatroom(sessionId);

    const intervalMs = 60_000;
    // Use a minute-aligned timestamp so ceiled now matches exactly
    const now = Math.ceil(Date.now() / 60_000) * 60_000;
    const lastRunAt = now - intervalMs + 50_000; // cadence slot is now + 50_000 (after ceiled now)

    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'reenable test',
      scheduleKind: 'interval',
      intervalMinutes: 1,
    });

    // Seed lastRunAt with a cadence-aligned nextRunAt that hasn't fired yet
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>, {
        lastRunAt,
        nextRunAt: lastRunAt + intervalMs,
      });
    });

    // Disable then re-enable (simulates user toggling off/on before next slot)
    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: false,
    });

    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: true,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.isRunnable).toBe(true);
    expect(row!.disabledReason).toBeUndefined();
    // Must preserve cadence: next slot is lastRunAt + interval (which is after ceiled now)
    expect(row!.nextRunAt).toBe(lastRunAt + intervalMs);
  });

  test('runDue does not pick up isRunnable: false rows', async () => {
    const { sessionId, userId } = await createTestSession('sp-run-due-skip');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    // Seed a disabled row with past nextRunAt
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'should not fire',
        scheduleKind: 'interval',
        intervalMinutes: 10,
        disabledReason: 'user',
        isRunnable: false,
        nextRunAt: now - 5000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // runDue should not throw and should not process the disabled row
    await t.mutation(api.scheduledPrompts.runDue as any, {});

    // Verify no message was created
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages).toHaveLength(0);
  });

  test('fireOne wakes offline agents when a scheduled prompt fires', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-wake-offline');
      const chatroomId = await createChatroom(sessionId);
      const machineId = 'sp-wake-offline-machine';
      await setupWakeableAgents({
        sessionId,
        chatroomId,
        machineId,
        roles: ['planner', 'builder'],
      });
      const id = await seedOverduePrompt(chatroomId, userId);

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      // The wake call is scheduled — it only runs once the scheduler advances.
      expect((await getInboxCommandsForMachine(machineId, 'agent.requestStart')).length).toBe(0);

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
      expect(starts.map((row) => row.command)).toHaveLength(2);
      expect(starts.map((row) => row.command)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'agent.requestStart',
            chatroomId,
            role: 'planner',
            model: TEST_MODEL_OPENCODE,
            workingDir: '/tmp/test',
          }),
          expect.objectContaining({
            type: 'agent.requestStart',
            chatroomId,
            role: 'builder',
            model: TEST_MODEL_OPENCODE,
            workingDir: '/tmp/test',
          }),
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test('fireOne does not restart a role already running in the primary workspace', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-wake-running-skip');
      const chatroomId = await createChatroom(sessionId);
      const machineId = 'sp-wake-running-skip-machine';
      await setupWakeableAgents({
        sessionId,
        chatroomId,
        machineId,
        roles: ['planner', 'builder'],
        statuses: { planner: 'waiting' },
      });
      const id = await seedOverduePrompt(chatroomId, userId);

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
      expect(starts.map((row) => row.command)).toHaveLength(1);
      expect(starts[0]?.command).toMatchObject({ role: 'builder' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('fireOne on a non-active chatroom queues no agent starts and disables the prompt', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-wake-inactive');
      const chatroomId = await createChatroom(sessionId);
      const machineId = 'sp-wake-inactive-machine';
      await setupWakeableAgents({
        sessionId,
        chatroomId,
        machineId,
        roles: ['planner', 'builder'],
      });
      const id = await seedOverduePrompt(chatroomId, userId);

      // Mark the chatroom completed (the only non-active status).
      await t.run(async (ctx) => {
        await ctx.db.patch('chatroom_rooms', chatroomId, { status: 'completed' });
      });

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
      expect(starts).toHaveLength(0);

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.isRunnable).toBe(false);
      expect(row!.nextRunAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('fireOne does not wake agents when the send is not ok', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-wake-send-failed');
      const chatroomId = await createChatroom(sessionId);
      const machineId = 'sp-wake-send-failed-machine';
      await setupWakeableAgents({
        sessionId,
        chatroomId,
        machineId,
        roles: ['planner', 'builder'],
      });
      // Whitespace-only prompt: sendAutomatedUserMessage rejects it (empty_content).
      const id = await seedOverduePrompt(chatroomId, userId, '   ');

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
      expect(starts).toHaveLength(0);

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.lastRunAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('runDue → fireOne end-to-end wakes offline agents', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-run-due-wake-e2e');
      const chatroomId = await createChatroom(sessionId);
      const machineId = 'sp-run-due-wake-e2e-machine';
      await setupWakeableAgents({
        sessionId,
        chatroomId,
        machineId,
        roles: ['planner', 'builder'],
      });
      await seedOverduePrompt(chatroomId, userId);

      // Drive the real cron entry point, not fireOne directly.
      await t.mutation(api.scheduledPrompts.runDue as any, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
      expect(starts.map((row) => row.command)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'agent.requestStart', chatroomId, role: 'planner' }),
          expect.objectContaining({ type: 'agent.requestStart', chatroomId, role: 'builder' }),
        ])
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
