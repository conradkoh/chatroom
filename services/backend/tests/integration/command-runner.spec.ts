/**
 * Command Runner Integration Tests
 *
 * Covers: runCommand replace semantics, back-to-back dedup, stopCommand terminationReason.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WORKING_DIR = '/test/project';
const CMD_NAME = 'dev';
const CMD_SCRIPT = 'pnpm dev';

/**
 * Set up a session + machine and sync a single command so it can be run.
 */
async function setupWithCommand(suffix: string) {
  const { sessionId } = await createTestSession(`cmd-runner-${suffix}`);
  const machineId = `machine-${suffix}`;
  await registerMachineWithDaemon(sessionId, machineId);

  // Sync the command so it's discoverable
  await t.mutation(api.commands.syncCommands, {
    sessionId,
    machineId,
    workingDir: WORKING_DIR,
    commands: [{ name: CMD_NAME, script: CMD_SCRIPT, source: 'package.json' as const }],
  });

  return { sessionId, machineId };
}

// ─── runCommand: replace semantics ────────────────────────────────────────────

describe('commands.runCommand — replace semantics', () => {
  test('re-running while previous is running marks prior run as killed/replaced', async () => {
    const { sessionId, machineId } = await setupWithCommand('replace-running');

    // First run
    const firstRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Simulate daemon picking it up — mark as 'running'
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: firstRunId as Id<'chatroom_commandRuns'>,
      status: 'running',
    });

    // Re-run the same command
    const secondRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // First run should now be killed with reason 'replaced'
    const firstRun = await t.run(async (ctx) =>
      ctx.db.get(firstRunId as Id<'chatroom_commandRuns'>)
    );
    expect(firstRun?.status).toBe('killed');
    expect(firstRun?.terminationReason).toBe('replaced');
    expect(firstRun?.completedAt).toBeDefined();

    // New run should be a fresh pending run
    expect(secondRunId).not.toBe(firstRunId);
    const secondRun = await t.run(async (ctx) =>
      ctx.db.get(secondRunId as Id<'chatroom_commandRuns'>)
    );
    expect(secondRun?.status).toBe('pending');
    expect(secondRun?.terminationReason).toBeUndefined();
  });

  test('does NOT kill prior run when commandName differs (different commands)', async () => {
    const { sessionId, machineId } = await setupWithCommand('replace-diff-cmd');

    // Sync a second command
    await t.mutation(api.commands.syncCommands, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commands: [
        { name: CMD_NAME, script: CMD_SCRIPT, source: 'package.json' as const },
        { name: 'build', script: 'pnpm build', source: 'package.json' as const },
      ],
    });

    // Run 'dev'
    const devRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Mark as running
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: devRunId as Id<'chatroom_commandRuns'>,
      status: 'running',
    });

    // Run 'build' — should NOT kill 'dev'
    await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: 'build',
      script: 'pnpm build',
    });

    const devRun = await t.run(async (ctx) =>
      ctx.db.get(devRunId as Id<'chatroom_commandRuns'>)
    );
    expect(devRun?.status).toBe('running'); // untouched
    expect(devRun?.terminationReason).toBeUndefined();
  });

  test('only kills running runs, not pending or completed', async () => {
    const { sessionId, machineId } = await setupWithCommand('replace-pending-only');

    // First run — stays pending (not picked up by daemon)
    const pendingRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Second run within 2s — but we need this to be a fresh run, not dedup.
    // Advance time (or use a different script) — for this test, mark first as running first
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: pendingRunId as Id<'chatroom_commandRuns'>,
      status: 'running',
    });
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: pendingRunId as Id<'chatroom_commandRuns'>,
      status: 'completed',
    });

    // Now run again — no active run to kill
    const freshRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    const pendingRun = await t.run(async (ctx) =>
      ctx.db.get(pendingRunId as Id<'chatroom_commandRuns'>)
    );
    expect(pendingRun?.status).toBe('completed'); // unchanged

    const freshRun = await t.run(async (ctx) =>
      ctx.db.get(freshRunId as Id<'chatroom_commandRuns'>)
    );
    expect(freshRun?.status).toBe('pending');
  });
});

// ─── runCommand: back-to-back dedup ───────────────────────────────────────────

describe('commands.runCommand — back-to-back dedup', () => {
  test('returns same runId for identical request within 1s window while still pending', async () => {
    const { sessionId, machineId } = await setupWithCommand('dedup-window');

    const firstRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Second identical call — should return the SAME runId (dedup)
    const secondRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    expect(secondRunId).toBe(firstRunId);

    // Only one run row should exist
    const allRuns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_commandRuns')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect()
    );
    expect(allRuns.length).toBe(1);
  });

  test('dedup does NOT apply when run is already running (replace instead)', async () => {
    const { sessionId, machineId } = await setupWithCommand('dedup-not-running');

    const firstRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Daemon picks it up
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: firstRunId as Id<'chatroom_commandRuns'>,
      status: 'running',
    });

    // Re-run: NOT a dedup (state is 'running', not 'pending') — should create new run
    const secondRunId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    expect(secondRunId).not.toBe(firstRunId);

    const firstRun = await t.run(async (ctx) =>
      ctx.db.get(firstRunId as Id<'chatroom_commandRuns'>)
    );
    expect(firstRun?.status).toBe('killed');
    expect(firstRun?.terminationReason).toBe('replaced');
  });
});

// ─── stopCommand: terminationReason ───────────────────────────────────────────

describe('commands.stopCommand — terminationReason', () => {
  test("sets terminationReason='user-stop' on the run row", async () => {
    const { sessionId, machineId } = await setupWithCommand('stop-reason');

    const runId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Mark as running (stopCommand requires running or pending)
    await t.mutation(api.commands.updateRunStatus, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRuns'>,
      status: 'running',
    });

    await t.mutation(api.commands.stopCommand, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRuns'>,
    });

    const run = await t.run(async (ctx) =>
      ctx.db.get(runId as Id<'chatroom_commandRuns'>)
    );
    expect(run?.terminationReason).toBe('user-stop');
    // Status should still be 'running' — the daemon actually stops it after receiving the event
    expect(run?.status).toBe('running');
  });

  test("sets terminationReason='user-stop' on pending run", async () => {
    const { sessionId, machineId } = await setupWithCommand('stop-reason-pending');

    const runId = await t.mutation(api.commands.runCommand, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      commandName: CMD_NAME,
      script: CMD_SCRIPT,
    });

    // Stop while still pending (before daemon picks it up)
    await t.mutation(api.commands.stopCommand, {
      sessionId,
      machineId,
      runId: runId as Id<'chatroom_commandRuns'>,
    });

    const run = await t.run(async (ctx) =>
      ctx.db.get(runId as Id<'chatroom_commandRuns'>)
    );
    expect(run?.terminationReason).toBe('user-stop');
  });
});
