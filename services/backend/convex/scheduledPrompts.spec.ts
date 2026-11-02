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

async function seedOverdueOncePrompt(
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>,
  prompt = 'once message'
): Promise<Id<'chatroom_scheduledPrompts'>> {
  const now = Date.now();
  const runAt = now - 1000; // overdue
  return await t.run(async (ctx) =>
    ctx.db.insert('chatroom_scheduledPrompts', {
      chatroomId,
      prompt,
      scheduleKind: 'once',
      runAt,
      disabledReason: undefined,
      isRunnable: true,
      nextRunAt: runAt,
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

  test('fireOne fires a one-time row exactly once and marks it completed', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-fire-exactly-once');
      const chatroomId = await createChatroom(sessionId);
      const id = await seedOverdueOncePrompt(chatroomId, userId);

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.disabledReason).toBe('completed');
      expect(row!.isRunnable).toBe(false);
      expect(row!.nextRunAt).toBeUndefined();
      expect(row!.lastRunAt).toBeDefined();

      const messages = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', id))
          .collect()
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]!.sourcePlatform).toBe('scheduled');

      // A second fire must be a no-op: the terminal state is not re-armable.
      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const messagesAfterSecondFire = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', id))
          .collect()
      );
      expect(messagesAfterSecondFire).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('runDue fires a one-time row once end to end', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-run-due');
      const chatroomId = await createChatroom(sessionId);
      const id = await seedOverdueOncePrompt(chatroomId, userId);

      await t.mutation(api.scheduledPrompts.runDue as any, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const firstPass = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', id))
          .collect()
      );
      expect(firstPass).toHaveLength(1);

      // A second cron pass must not fire the completed row again.
      await t.mutation(api.scheduledPrompts.runDue as any, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const secondPass = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', id))
          .collect()
      );
      expect(secondPass).toHaveLength(1);

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.disabledReason).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('create validates and stores a one-time schedule', async () => {
    const { sessionId } = await createTestSession('sp-once-create');
    const chatroomId = await createChatroom(sessionId);

    const runAt = Date.now() + 3_600_000;
    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'one time prompt',
      scheduleKind: 'once',
      runAt,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.scheduleKind).toBe('once');
    expect(row!.runAt).toBe(runAt);
    expect(row!.nextRunAt).toBe(runAt);
    expect(row!.isRunnable).toBe(true);
    expect(row!.disabledReason).toBeUndefined();
    expect(row!.intervalMinutes).toBeUndefined();
    expect(row!.hourUTC).toBeUndefined();
    expect(row!.minuteUTC).toBeUndefined();

    await expect(
      t.mutation(api.scheduledPrompts.create, {
        sessionId,
        chatroomId,
        prompt: 'past prompt',
        scheduleKind: 'once',
        runAt: Date.now() - 60_000,
      })
    ).rejects.toThrow(/INVALID_SCHEDULE/);

    await expect(
      t.mutation(api.scheduledPrompts.create, {
        sessionId,
        chatroomId,
        prompt: 'missing time prompt',
        scheduleKind: 'once',
      })
    ).rejects.toThrow(/INVALID_SCHEDULE/);
  });

  test('update re-arms a pending one-time row and rejects a past time', async () => {
    const { sessionId } = await createTestSession('sp-once-update');
    const chatroomId = await createChatroom(sessionId);

    const firstRunAt = Date.now() + 3_600_000;
    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'one time prompt',
      scheduleKind: 'once',
      runAt: firstRunAt,
    });
    const scheduledPromptId = id as Id<'chatroom_scheduledPrompts'>;

    const secondRunAt = firstRunAt + 3_600_000;
    await t.mutation(api.scheduledPrompts.update, {
      sessionId,
      scheduledPromptId,
      scheduleKind: 'once',
      runAt: secondRunAt,
    });

    let row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', scheduledPromptId)
    );
    expect(row!.runAt).toBe(secondRunAt);
    expect(row!.nextRunAt).toBe(secondRunAt);

    await expect(
      t.mutation(api.scheduledPrompts.update, {
        sessionId,
        scheduledPromptId,
        scheduleKind: 'once',
        runAt: Date.now() - 60_000,
      })
    ).rejects.toThrow(/INVALID_SCHEDULE/);

    // A user-disabled row whose time has already passed can still be renamed
    // when the edit form resends the unchanged runAt.
    const { userId } = await createTestSession('sp-once-update-disabled-owner');
    const pastRunAt = Date.now() - 60_000;
    const disabledId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'disabled once prompt',
        scheduleKind: 'once',
        runAt: pastRunAt,
        disabledReason: 'user',
        isRunnable: false,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    await t.mutation(api.scheduledPrompts.update, {
      sessionId,
      scheduledPromptId: disabledId,
      name: 'renamed',
      scheduleKind: 'once',
      runAt: pastRunAt,
    });

    row = await t.run(async (ctx) => ctx.db.get('chatroom_scheduledPrompts', disabledId));
    expect(row!.name).toBe('renamed');
    expect(row!.runAt).toBe(pastRunAt);
    expect(row!.isRunnable).toBe(false);
  });

  test('update from interval to once clears recurring fields', async () => {
    const { sessionId } = await createTestSession('sp-once-from-interval');
    const chatroomId = await createChatroom(sessionId);

    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'recurring prompt',
      scheduleKind: 'interval',
      intervalMinutes: 30,
    });

    const runAt = Date.now() + 7_200_000;
    await t.mutation(api.scheduledPrompts.update, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      scheduleKind: 'once',
      runAt,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.scheduleKind).toBe('once');
    expect(row!.intervalMinutes).toBeUndefined();
    expect(row!.runAt).toBe(runAt);
    expect(row!.nextRunAt).toBe(runAt);
  });

  test('setEnabled round trip re-arms a future one-time row and rejects a past one', async () => {
    const { sessionId } = await createTestSession('sp-once-set-enabled');
    const chatroomId = await createChatroom(sessionId);

    const runAt = Date.now() + 3_600_000;
    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'one time prompt',
      scheduleKind: 'once',
      runAt,
    });
    const scheduledPromptId = id as Id<'chatroom_scheduledPrompts'>;

    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId,
      enabled: false,
    });
    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId,
      enabled: true,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', scheduledPromptId)
    );
    expect(row!.isRunnable).toBe(true);
    expect(row!.disabledReason).toBeUndefined();
    expect(row!.nextRunAt).toBe(runAt);

    const { userId } = await createTestSession('sp-once-set-enabled-past-owner');
    const pastId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'past once prompt',
        scheduleKind: 'once',
        runAt: Date.now() - 60_000,
        disabledReason: 'user',
        isRunnable: false,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: pastId,
        enabled: true,
      })
    ).rejects.toThrow(/INVALID_SCHEDULE/);
  });

  test('a completed one-time row is terminal', async () => {
    const { sessionId, userId } = await createTestSession('sp-once-completed');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'completed once prompt',
        scheduleKind: 'once',
        runAt: now - 60_000,
        disabledReason: 'completed',
        isRunnable: false,
        lastRunAt: now - 30_000,
        createdBy: userId,
        createdAt: now - 120_000,
        updatedAt: now - 30_000,
      })
    );

    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id,
        enabled: true,
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id,
        enabled: false,
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
    await expect(
      t.mutation(api.scheduledPrompts.update, {
        sessionId,
        scheduledPromptId: id,
        name: 'renamed',
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
  });

  test('a failed one-time row is terminal', async () => {
    const { sessionId, userId } = await createTestSession('sp-once-failed');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'failed once prompt',
        scheduleKind: 'once',
        runAt: now - 60_000,
        disabledReason: 'failed',
        isRunnable: false,
        lastRunAt: now - 30_000,
        createdBy: userId,
        createdAt: now - 120_000,
        updatedAt: now - 30_000,
      })
    );

    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id,
        enabled: true,
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id,
        enabled: false,
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
    await expect(
      t.mutation(api.scheduledPrompts.update, {
        sessionId,
        scheduledPromptId: id,
        name: 'renamed',
      })
    ).rejects.toThrow(/SCHEDULE_FINISHED/);
  });

  test('switching a one-time row to interval or daily clears runAt', async () => {
    const { sessionId } = await createTestSession('sp-once-to-recurring');
    const chatroomId = await createChatroom(sessionId);
    const futureRunAt = () => Date.now() + 3_600_000;

    const intervalId = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'once to interval',
      scheduleKind: 'once',
      runAt: futureRunAt(),
    });
    await t.mutation(api.scheduledPrompts.update, {
      sessionId,
      scheduledPromptId: intervalId as Id<'chatroom_scheduledPrompts'>,
      scheduleKind: 'interval',
      intervalMinutes: 15,
    });

    let row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', intervalId as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.scheduleKind).toBe('interval');
    expect(row!.runAt).toBeUndefined();
    expect(row!.intervalMinutes).toBe(15);
    expect(row!.nextRunAt).toBeDefined();

    const dailyId = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'once to daily',
      scheduleKind: 'once',
      runAt: futureRunAt(),
    });
    await t.mutation(api.scheduledPrompts.update, {
      sessionId,
      scheduledPromptId: dailyId as Id<'chatroom_scheduledPrompts'>,
      scheduleKind: 'daily',
      hourUTC: 9,
      minuteUTC: 30,
    });

    row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', dailyId as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.scheduleKind).toBe('daily');
    expect(row!.runAt).toBeUndefined();
    expect(row!.hourUTC).toBe(9);
    expect(row!.minuteUTC).toBe(30);
    expect(row!.nextRunAt).toBeDefined();
  });

  test('a one-time row whose send fails becomes terminal', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-send-failed');
      const chatroomId = await createChatroom(sessionId);
      // Whitespace-only prompt: sendAutomatedUserMessage rejects it (empty_content).
      const id = await seedOverdueOncePrompt(chatroomId, userId, '   ');

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.disabledReason).toBe('failed');
      expect(row!.isRunnable).toBe(false);
      expect(row!.nextRunAt).toBeUndefined();
      expect(row!.lastRunAt).toBeUndefined();

      await t.mutation(api.scheduledPrompts.runDue as any, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const messages = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', id))
          .collect()
      );
      expect(messages).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a one-time row on a non-active chatroom becomes failed', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-inactive');
      const chatroomId = await createChatroom(sessionId);
      const id = await seedOverdueOncePrompt(chatroomId, userId);

      await t.run(async (ctx) => {
        await ctx.db.patch('chatroom_rooms', chatroomId, { status: 'completed' });
      });

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const row = await t.run(async (ctx) =>
        ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
      );
      expect(row!.disabledReason).toBe('failed');
      expect(row!.isRunnable).toBe(false);
      expect(row!.nextRunAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a second overdue one-time row is queued behind the first task', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-queue');
      const chatroomId = await createChatroom(sessionId);
      const firstId = await seedOverdueOncePrompt(chatroomId, userId, 'first once message');
      const secondId = await seedOverdueOncePrompt(chatroomId, userId, 'second once message');

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: firstId });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: secondId });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const firstMessages = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messages')
          .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', firstId))
          .collect()
      );
      expect(firstMessages).toHaveLength(1);

      const queued = await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_messageQueue')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      );
      expect(queued).toHaveLength(1);
      expect(queued[0]!.scheduledPromptId).toBe(secondId);
      expect(queued[0]!.content).toBe('second once message');

      const rows = await t.run(async (ctx) =>
        Promise.all([
          ctx.db.get('chatroom_scheduledPrompts', firstId),
          ctx.db.get('chatroom_scheduledPrompts', secondId),
        ])
      );
      expect(rows[0]!.disabledReason).toBe('completed');
      expect(rows[1]!.disabledReason).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('listTriggeredMessages keeps history for a completed one-time row', async () => {
    vi.useFakeTimers();
    try {
      const { sessionId, userId } = await createTestSession('sp-once-history');
      const chatroomId = await createChatroom(sessionId);
      const id = await seedOverdueOncePrompt(chatroomId, userId, 'kept in history');

      await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const triggered = await t.query(api.scheduledPrompts.listTriggeredMessages, {
        sessionId,
        scheduledPromptId: id,
      });
      expect(triggered).toHaveLength(1);
      expect(triggered[0]!.content).toBe('kept in history');
    } finally {
      vi.useRealTimers();
    }
  });
});
