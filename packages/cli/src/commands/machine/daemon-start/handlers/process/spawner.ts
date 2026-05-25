import { spawn } from 'node:child_process';

import { api } from '../../../../../api.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import { encodeOutput } from '@workspace/backend/src/output-encoding.js';
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
import { createOutputStore, ensureTempDir } from './output-store.js';

let tempDirReady = false;

async function flushTail(ctx: DaemonContext, tracked: RunningProcess): Promise<void> {
  const tail = tracked.store.getTail();
  if (tail.content.length === 0) return;

  const compressed = encodeOutput(tail.content);
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunTail, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId: tracked.runId as any,
      tailOutput: {
        compression: compressed.compression,
        content: compressed.content,
        byteLength: tail.content.length,
        totalBytesWritten: tail.totalBytes,
        updatedAt: Date.now(),
      },
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to flush tail for run ${tracked.runId}: ${getErrorMessage(err)}`
    );
  }
}

async function flushFinalChunks(
  ctx: DaemonContext,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
  await flushTail(ctx, tracked);

  let fullOutput: string;
  try {
    fullOutput = await tracked.store.getFullOutput();
  } catch (err) {
    console.error(
      `[${formatTimestamp()}] ❌ Failed to read temp file for run ${tracked.runId}: ${getErrorMessage(err)}`
    );
    fullOutput = tracked.store.getTail().content;
  }

  if (fullOutput.length === 0) return;

  let chunkIndex = 0;
  for (let i = 0; i < fullOutput.length; i += MAX_BUFFER_SIZE) {
    const slice = fullOutput.slice(i, i + MAX_BUFFER_SIZE);
    const compressed = encodeOutput(slice);
    try {
      await ctx.deps.backend.mutation(api.commands.appendOutput, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        content: compressed,
        chunkIndex,
      });
      chunkIndex++;
    } catch (err) {
      console.error(
        `[${formatTimestamp()}] ❌ Failed to flush final chunk ${chunkIndex} for run ${tracked.runId}: ${getErrorMessage(err)}`
      );
      return;
    }
  }
}

export async function spawnCommandProcess(
  ctx: DaemonContext,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  },
  commandKey: string
): Promise<RunningProcess> {
  const { workingDir, commandName, script, runId } = event;
  const runIdStr = runId.toString();

  if (!tempDirReady) {
    await ensureTempDir();
    tempDirReady = true;
  }

  const store = createOutputStore(runIdStr);

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
    store,
    startedAt: Date.now(),
    flushTimer: setInterval(() => {
      flushTail(ctx, tracked).catch(() => {});
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
    tracked.store.append(data.toString()).catch(() => {});
  });

  child.stderr?.on('data', (data: Buffer) => {
    tracked.store.append(data.toString()).catch(() => {});
  });

  const finalize = async (code: number | null, signal: NodeJS.Signals | null) => {
    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);

    if (tracked.process.pid != null) {
      untrackChildPid(tracked.process.pid);
    }

    await flushFinalChunks(ctx, tracked, runId);
    await tracked.store.destroy();
    processManager.unregister(runIdStr, commandKey);

    const status = deriveTerminalStatus(
      code,
      signal,
      tracked.terminationIntent
    );

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status,
        exitCode: code ?? undefined,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update run status on exit: ${getErrorMessage(err)}`
      );
    }
  };

  child.on('exit', (code, signal) => {
    console.log(
      `[${formatTimestamp()}] 🏁 Command exited: ${commandName} (code=${code}, signal=${signal})`
    );
    finalize(code, signal as NodeJS.Signals | null).catch(() => {});
  });

  child.on('error', async (err) => {
    console.error(`[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`);
    finalize(null, null).catch(() => {});
  });

  return tracked;
}
