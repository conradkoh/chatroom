import { spawn } from 'node:child_process';

import { api } from '../../../../../api.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { DaemonContext, SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';
import { trackChildPid, untrackChildPid } from '../orphan-tracker.js';
import {
  OUTPUT_FLUSH_INTERVAL_MS,
  MAX_BUFFER_SIZE,
  SOFT_TIMEOUT_MS,
  SIGTERM_GRACE_PERIOD_MS,
  deriveTerminalStatus,
  type RunningProcess,
} from './state.js';
import { processManager } from './manager.js';
import { killProcess } from './killer.js';

async function flushOutput(ctx: DaemonContext, tracked: RunningProcess): Promise<void> {
  if (tracked.outputBuffer.length === 0) return;

  const content = tracked.outputBuffer;
  tracked.outputBuffer = '';

  const slices: string[] = [];
  for (let i = 0; i < content.length; i += MAX_BUFFER_SIZE) {
    slices.push(content.slice(i, i + MAX_BUFFER_SIZE));
  }

  for (let i = 0; i < slices.length; i++) {
    const chunkIndex = tracked.chunkIndex++;
    try {
      await ctx.deps.backend.mutation(api.commands.appendOutput, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: tracked.runId as any,
        content: slices[i],
        chunkIndex,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to flush output for run ${tracked.runId}: ${getErrorMessage(err)}`
      );
      tracked.outputBuffer = slices.slice(i).join('') + tracked.outputBuffer;
      tracked.chunkIndex--;
      return;
    }
  }
}

function appendToBuffer(ctx: DaemonContext, tracked: RunningProcess, data: string): void {
  tracked.outputBuffer += data;

  if (tracked.outputBuffer.length >= MAX_BUFFER_SIZE) {
    flushOutput(ctx, tracked).catch(() => {});
  }
}

export function spawnCommandProcess(
  ctx: DaemonContext,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  },
  commandKey: string
): RunningProcess {
  const { workingDir, commandName, script, runId } = event;
  const runIdStr = runId.toString();

  const child = spawn('sh', ['-c', script], {
    cwd: workingDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const tracked: RunningProcess = {
    process: child,
    runId: runIdStr,
    commandKey,
    outputBuffer: '',
    chunkIndex: 0,
    flushTimer: setInterval(() => {
      flushOutput(ctx, tracked).catch(() => {});
    }, OUTPUT_FLUSH_INTERVAL_MS),
    softTimeoutTimer: null,
    terminationIntent: null,
  };
  tracked.flushTimer.unref?.();

  processManager.register(runIdStr, commandKey, tracked);

  if (child.pid != null) {
    trackChildPid(child.pid);
  }

  const softTimeoutTimer = setTimeout(async () => {
    console.log(
      `[${formatTimestamp()}] ⏰ Command soft timeout (24h): ${commandName} (runId: ${runIdStr})`
    );
    const currentTracked = processManager.get(runIdStr);
    if (!currentTracked) return;

    currentTracked.terminationIntent = 'killed';

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'killed',
        terminationReason: 'timeout-24h',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark run as killed (timeout): ${getErrorMessage(err)}`
      );
    }

    killProcess(child, 'SIGTERM');
    setTimeout(() => {
      if (!processManager.has(runIdStr)) return;
      console.log(`[${formatTimestamp()}] 🔪 Force-killing timed-out process: ${runIdStr}`);
      killProcess(child, 'SIGKILL');
    }, SIGTERM_GRACE_PERIOD_MS);
  }, SOFT_TIMEOUT_MS);
  softTimeoutTimer.unref?.();
  tracked.softTimeoutTimer = softTimeoutTimer;

  child.stdout?.on('data', (data: Buffer) => {
    appendToBuffer(ctx, tracked, data.toString());
  });

  child.stderr?.on('data', (data: Buffer) => {
    appendToBuffer(ctx, tracked, data.toString());
  });

  child.on('exit', async (code, signal) => {
    console.log(
      `[${formatTimestamp()}] 🏁 Command exited: ${commandName} (code=${code}, signal=${signal})`
    );

    await flushOutput(ctx, tracked).catch(() => {});

    if (tracked.process.pid != null) {
      untrackChildPid(tracked.process.pid);
    }

    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
    processManager.unregister(runIdStr, commandKey);

    const status = deriveTerminalStatus(
      code,
      signal as NodeJS.Signals | null,
      tracked.terminationIntent
    );

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: status,
        exitCode: code ?? undefined,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update run status on exit: ${getErrorMessage(err)}`
      );
    }
  });

  child.on('error', async (err) => {
    console.error(`[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`);

    if (tracked.process.pid != null) {
      untrackChildPid(tracked.process.pid);
    }

    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
    processManager.unregister(runIdStr, commandKey);

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'failed',
      });
    } catch (updateErr) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update run status on error: ${getErrorMessage(updateErr)}`
      );
    }
  });

  return tracked;
}
