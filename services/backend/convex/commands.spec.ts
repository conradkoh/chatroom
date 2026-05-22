/**
 * Commands Unit Tests
 *
 * Covers: stopCommand pending-path (inline stop), stopCommand running-path
 * (daemon event), stopCommand terminal-state error, clearStuckCommandRuns
 * happy path, scoping to workingDir, and auth.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from '../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../tests/helpers/integration';

// ─── Constants ──────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function setupMachine(suffix: string) {
  const { sessionId } = await createTestSession(`cmds-spec-${suffix}`);
  const machineId = `machine-${suffix}`;
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

async function createPendingRun(
  sessionId: string,
  machineId: string,
  workingDir: string,
  commandName: string
): Promise<Id<'chatroom_commandRuns'>> {
  // Sync the command first
  await t.mutation(api.commands.syncCommands, {
    sessionId,
    machineId,
    workingDir,
    commands: [{ name: commandName, script: 'echo test', source: 'package.json' as const }],
  });

  // Run it — starts as 'pending' since no daemon picks it up
  const runId = await t.mutation(api.commands.runCommand, {
    sessionId,
    machineId,
    workingDir,
    commandName,
    script: 'echo test',
  });
  return runId as Id<'chatroom_commandRuns'>;
}

async function createRunningRun(
  sessionId: string,
  machineId: string,
  workingDir: string,
  commandName: string
): Promise<Id<'chatroom_commandRuns'>> {
  const runId = await createPendingRun(sessionId, machineId, workingDir, commandName);
  // Simulate daemon picking it up
  await t.mutation(api.commands.updateRunStatus, {
    sessionId,
    machineId,
    runId,
    status: 'running',
  });
  return runId;
}

async function getRunStopEvents(runId: Id<'chatroom_commandRuns'>) {
  return t.run(async (ctx) => {
    const all = await ctx.db.query('chatroom_eventStream').collect();
    return all.filter(
      (e: any) => e.type === 'command.stop' && e.runId === runId.toString()
    );
  });
}

async function getRun(runId: Id<'chatroom_commandRuns'>) {
  return t.run(async (ctx) => ctx.db.get('chatroom_commandRuns', runId));
}

// ─── stopCommand tests ──────────────────────────────────────────────────────

describe('stopCommand', () => {
  test('pending run → transitions to stopped inline, no command.stop event', async () => {
    const { sessionId, machineId } = await setupMachine('stop-pending');
    const runId = await createPendingRun(sessionId, machineId, '/tmp/ws', 'dev');

    await t.mutation(api.commands.stopCommand, { sessionId, machineId, runId });

    const run = await getRun(runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe('stopped');
    expect(run!.terminationReason).toBe('user-stop');
    expect(run!.completedAt).toBe(FIXED_NOW);

    const stopEvents = await getRunStopEvents(runId);
    expect(stopEvents).toHaveLength(0);
  });

  test('running run → terminationReason set, command.stop event dispatched', async () => {
    const { sessionId, machineId } = await setupMachine('stop-running');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    await t.mutation(api.commands.stopCommand, { sessionId, machineId, runId });

    const run = await getRun(runId);
    expect(run!.terminationReason).toBe('user-stop');
    // Status should NOT be changed by stopCommand for running runs
    expect(run!.status).toBe('running');

    const stopEvents = await getRunStopEvents(runId);
    expect(stopEvents).toHaveLength(1);
  });

  test('terminal run → throws ConvexError COMMAND_NOT_RUNNING', async () => {
    const { sessionId, machineId } = await setupMachine('stop-terminal');
    const runId = await createPendingRun(sessionId, machineId, '/tmp/ws', 'dev');

    // First stop — transitions to stopped (pending path)
    await t.mutation(api.commands.stopCommand, { sessionId, machineId, runId });

    // Second stop on now-stopped run should fail
    await expect(
      t.mutation(api.commands.stopCommand, { sessionId, machineId, runId })
    ).rejects.toThrow(/COMMAND_NOT_RUNNING|Command is not running/);
  });
});

// ─── clearStuckCommandRuns tests ────────────────────────────────────────────

describe('clearStuckCommandRuns', () => {
  test('clears pending + running, leaves completed untouched', async () => {
    const { sessionId, machineId } = await setupMachine('clear-happy');
    const wd = '/tmp/ws';

    // Create 2 pending + 1 running + 1 completed
    const p1 = await createPendingRun(sessionId, machineId, wd, 'dev');
    const p2 = await createPendingRun(sessionId, machineId, wd, 'build');
    const r1 = await createRunningRun(sessionId, machineId, wd, 'test');

    // Make one run completed (stop via stopCommand on pending)
    const completed = await createPendingRun(sessionId, machineId, wd, 'lint');
    await t.mutation(api.commands.stopCommand, { sessionId, machineId, runId: completed });

    const result = await t.mutation(api.commands.clearStuckCommandRuns, {
      sessionId,
      machineId,
      workingDir: wd,
    });

    expect(result.clearedCount).toBe(3);

    // Verify pending runs are now stopped
    for (const id of [p1, p2]) {
      const run = await getRun(id);
      expect(run!.status).toBe('stopped');
      expect(run!.terminationReason).toBe('user-clear-stuck');
      expect(run!.completedAt).toBe(FIXED_NOW);
    }

    // Running run also stopped
    const runR1 = await getRun(r1);
    expect(runR1!.status).toBe('stopped');
    expect(runR1!.terminationReason).toBe('user-clear-stuck');

    // Completed run untouched
    const runComp = await getRun(completed);
    expect(runComp!.status).toBe('stopped');
    expect(runComp!.terminationReason).toBe('user-stop');
  });

  test('scoped to workingDir — does not touch other workingDir', async () => {
    const { sessionId, machineId } = await setupMachine('clear-scoped');

    const pA = await createPendingRun(sessionId, machineId, '/tmp/wsA', 'dev');
    const pB = await createPendingRun(sessionId, machineId, '/tmp/wsB', 'dev');

    await t.mutation(api.commands.clearStuckCommandRuns, {
      sessionId,
      machineId,
      workingDir: '/tmp/wsA',
    });

    const runA = await getRun(pA);
    expect(runA!.status).toBe('stopped'); // cleared

    const runB = await getRun(pB);
    expect(runB!.status).toBe('pending'); // untouched
  });

  test('auth — no machine access throws', async () => {
    const { sessionId, machineId } = await setupMachine('clear-auth');
    await createPendingRun(sessionId, machineId, '/tmp/ws', 'dev');

    // Use a different user session
    const { sessionId: otherSession } = await createTestSession('cmds-spec-clear-auth-other');

    await expect(
      t.mutation(api.commands.clearStuckCommandRuns, {
        sessionId: otherSession,
        machineId,
        workingDir: '/tmp/ws',
      })
    ).rejects.toThrow();
  });
});

// ─── updateRunStatus idempotency & structured error tests ───────────────────

describe('updateRunStatus', () => {
  test('killed → stopped is a no-op (race condition idempotency)', async () => {
    const { sessionId, machineId } = await setupMachine('urs-killed-stopped');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    // Simulate runCommand marking it killed (replace semantics)
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_commandRuns', runId, { status: 'killed', completedAt: FIXED_NOW });
    });

    // Daemon exit handler reports stopped — should be silently ignored, not throw
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'stopped' });

    const run = await getRun(runId);
    expect(run!.status).toBe('killed'); // unchanged — first terminal write wins
  });

  test('stopped → killed is a no-op (terminal → terminal idempotency)', async () => {
    const { sessionId, machineId } = await setupMachine('urs-stopped-killed');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'stopped' });

    // Second terminal transition should be silently ignored, not throw
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'killed' });

    const run = await getRun(runId);
    expect(run!.status).toBe('stopped'); // first terminal state wins
  });

  test('completed → failed is a no-op (any terminal → terminal is idempotent)', async () => {
    const { sessionId, machineId } = await setupMachine('urs-completed-failed');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'completed' });

    // Any subsequent terminal report is a no-op
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'failed' });

    const run = await getRun(runId);
    expect(run!.status).toBe('completed'); // first terminal state wins
  });

  test('invalid transition throws structured INVALID_RUN_STATE_TRANSITION error', async () => {
    const { sessionId, machineId } = await setupMachine('urs-invalid-transition');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    // running → running is not a valid transition
    await expect(
      t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId, status: 'running' })
    ).rejects.toThrow(/INVALID_RUN_STATE_TRANSITION/);
  });
});

// ─── reapOrphansForDaemonRestart tests ─────────────────────────────────────

describe('reapOrphansForDaemonRestart', () => {
  test('reaps a running row — marks it killed with terminationReason=daemon-restart', async () => {
    const { sessionId, machineId } = await setupMachine('reap-running');
    const runId = await createRunningRun(sessionId, machineId, '/tmp/ws', 'dev');

    const result = await t.mutation(api.commands.reapOrphansForDaemonRestart, {
      sessionId,
      machineId,
    });

    expect(result.reapedCount).toBe(1);
    const run = await getRun(runId);
    expect(run!.status).toBe('killed');
    expect(run!.terminationReason).toBe('daemon-restart');
    expect(run!.completedAt).toBe(FIXED_NOW);
  });

  test('reaps a pending row — marks it killed with terminationReason=daemon-restart', async () => {
    const { sessionId, machineId } = await setupMachine('reap-pending');
    const runId = await createPendingRun(sessionId, machineId, '/tmp/ws', 'build');

    const result = await t.mutation(api.commands.reapOrphansForDaemonRestart, {
      sessionId,
      machineId,
    });

    expect(result.reapedCount).toBe(1);
    const run = await getRun(runId);
    expect(run!.status).toBe('killed');
    expect(run!.terminationReason).toBe('daemon-restart');
    expect(run!.completedAt).toBe(FIXED_NOW);
  });

  test('leaves terminal rows (completed/failed/stopped/killed) untouched', async () => {
    const { sessionId, machineId } = await setupMachine('reap-terminal');
    const wd = '/tmp/ws';

    // completed
    const completedId = await createRunningRun(sessionId, machineId, wd, 'dev');
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId: completedId, status: 'completed' });

    // failed
    const failedId = await createRunningRun(sessionId, machineId, wd, 'build');
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId: failedId, status: 'failed' });

    // stopped
    const stoppedId = await createPendingRun(sessionId, machineId, wd, 'test');
    await t.mutation(api.commands.stopCommand, { sessionId, machineId, runId: stoppedId });

    // killed
    const killedId = await createRunningRun(sessionId, machineId, wd, 'lint');
    await t.mutation(api.commands.updateRunStatus, { sessionId, machineId, runId: killedId, status: 'killed' });

    const result = await t.mutation(api.commands.reapOrphansForDaemonRestart, {
      sessionId,
      machineId,
    });

    expect(result.reapedCount).toBe(0);
    // All statuses unchanged
    expect((await getRun(completedId))!.status).toBe('completed');
    expect((await getRun(failedId))!.status).toBe('failed');
    expect((await getRun(stoppedId))!.status).toBe('stopped');
    expect((await getRun(killedId))!.status).toBe('killed');
  });

  test('only affects the given machineId', async () => {
    const { sessionId, machineId: machineA } = await setupMachine('reap-scope-a');
    const { sessionId: sessionB, machineId: machineB } = await setupMachine('reap-scope-b');

    const runA = await createRunningRun(sessionId, machineA, '/tmp/ws', 'dev');
    const runB = await createPendingRun(sessionB, machineB, '/tmp/ws', 'dev');

    const result = await t.mutation(api.commands.reapOrphansForDaemonRestart, {
      sessionId,
      machineId: machineA,
    });

    expect(result.reapedCount).toBe(1);
    expect((await getRun(runA))!.status).toBe('killed');   // reaped
    expect((await getRun(runB))!.status).toBe('pending'); // untouched
  });

  test('returns {reapedCount: N} for multiple orphans', async () => {
    const { sessionId, machineId } = await setupMachine('reap-count');
    const wd = '/tmp/ws';

    await createPendingRun(sessionId, machineId, wd, 'dev');
    await createRunningRun(sessionId, machineId, wd, 'build');
    await createPendingRun(sessionId, machineId, wd, 'test');

    const result = await t.mutation(api.commands.reapOrphansForDaemonRestart, {
      sessionId,
      machineId,
    });

    expect(result.reapedCount).toBe(3);
  });

  test('auth — no machine access throws', async () => {
    const { sessionId, machineId } = await setupMachine('reap-auth');
    await createPendingRun(sessionId, machineId, '/tmp/ws', 'dev');

    const { sessionId: otherSession } = await createTestSession('cmds-spec-reap-auth-other');

    await expect(
      t.mutation(api.commands.reapOrphansForDaemonRestart, {
        sessionId: otherSession,
        machineId,
      })
    ).rejects.toThrow();
  });
});
