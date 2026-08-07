/**
 * stopAllCommandRunsForChatroom — Integration Tests
 *
 * Verifies the sidebar stop path: stopping a chatroom stops all pending/running
 * command runs across the chatroom's registered workspaces, while completed
 * runs are left untouched.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKING_DIR = '/test/project';
const CMD_NAME = 'dev';
const CMD_SCRIPT = 'pnpm dev';

/**
 * Register a workspace in a chatroom for a machine.
 * Returns the workspaceId.
 */
async function registerWorkspace(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId: sessionId as any,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

/**
 * Set up a session + duo chatroom + machine + registered workspace + synced command.
 */
async function setupChatroomWithWorkspaceAndCommand(suffix: string) {
  const { sessionId } = await createTestSession(`stop-all-${suffix}`);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = `machine-${suffix}`;
  await registerMachineWithDaemon(sessionId, machineId);
  await registerWorkspace(sessionId, chatroomId, machineId, WORKING_DIR);

  await t.mutation(api.commands.syncCommands, {
    sessionId,
    machineId,
    workingDir: WORKING_DIR,
    commands: [{ name: CMD_NAME, script: CMD_SCRIPT, source: 'package.json' as const }],
  });

  return { sessionId, chatroomId, machineId };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('commands.stopAllCommandRunsForChatroom', () => {
  test('running run: sets terminationReason=user-stop, status stays running', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupChatroomWithWorkspaceAndCommand('running');

    const runId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Daemon picks it up — mark as running
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRunsV2'>,
      status: 'running',
    });

    const result = await t.mutation(api.commands.stopAllCommandRunsForChatroom, {
      sessionId,
      chatroomId,
    });

    expect(result.stoppedCount).toBe(1);
    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<'chatroom_commandRunsV2'>));
    expect(run?.terminationReason).toBe('user-stop');
    // Status stays 'running' — the daemon actually stops the process afterwards.
    expect(run?.status).toBe('running');
  });

  test('pending run: status flips to stopped', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupChatroomWithWorkspaceAndCommand('pending');

    const runId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    const result = await t.mutation(api.commands.stopAllCommandRunsForChatroom, {
      sessionId,
      chatroomId,
    });

    expect(result.stoppedCount).toBe(1);
    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<'chatroom_commandRunsV2'>));
    expect(run?.status).toBe('stopped');
    expect(run?.terminationReason).toBe('user-stop');
  });

  test('completed run: unaffected and excluded from stoppedCount', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupChatroomWithWorkspaceAndCommand('completed');

    const runId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Daemon lifecycle: pending → running → completed
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRunsV2'>,
      status: 'running',
    });
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRunsV2'>,
      status: 'completed',
    });

    const result = await t.mutation(api.commands.stopAllCommandRunsForChatroom, {
      sessionId,
      chatroomId,
    });

    expect(result.stoppedCount).toBe(0);
    const run = await t.run(async (ctx) => ctx.db.get(runId as Id<'chatroom_commandRunsV2'>));
    expect(run?.status).toBe('completed');
    expect(run?.terminationReason).toBeUndefined();
  });
});
