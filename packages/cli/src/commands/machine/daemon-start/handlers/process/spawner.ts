import { spawn } from 'node:child_process';

import { encodeOutput } from '@workspace/backend/src/output-encoding.js';

import { killProcess } from './killer.js';
import { consumePendingFullSync, isRunLogObserved } from './log-observer-sync.js';
import { processManager } from './manager.js';
import { createOutputStore, ensureTempDir, MAX_TAIL_LINES_V2 } from './output-store.js';
import {
  OUTPUT_FLUSH_INTERVAL_MS,
  MAX_BUFFER_SIZE,
  SOFT_TIMEOUT_MS,
  SIGTERM_GRACE_PERIOD_MS,
  deriveTerminalStatus,
  type RunningProcess,
} from './state.js';
import { api } from '../../../../../api.js';
import type { BackendOps } from '../../../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';
import { trackChildPid, untrackChildPid } from '../orphan-tracker.js';

let tempDirReady = false;

/**
 * Minimal structural type accepted by all ctx-using functions in spawner.ts.
 * DaemonContext structurally satisfies this type, so all old call sites continue
 * to work without modification. New Effect-based callers pass a plain object.
 */
type SpawnCtx = {
  sessionId: SessionId;
  machineId: string;
  deps: { backend: BackendOps };
};

async function flushTailV2(ctx: SpawnCtx, tracked: RunningProcess, force = false): Promise<void> {
  if (!force && !isRunLogObserved(tracked.runId)) return;

  const tail = await tracked.store.getLastNLines(MAX_TAIL_LINES_V2);
  if (tail.content.length === 0) return;

  const compressed = encodeOutput(tail.content);
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunTailV2, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId: tracked.runId as any,
      tailOutput: {
        compression: compressed.compression,
        content: compressed.content,
        byteLength: tail.totalBytes,
        totalBytesWritten: tail.totalBytes,
        updatedAt: Date.now(),
        lineCount: tail.lineCount,
      },
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to flush tail for run ${tracked.runId}: ${getErrorMessage(err)}`
    );
  }
}

async function appendFullOutputChunks(
  ctx: SpawnCtx,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
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
        `[${formatTimestamp()}] ❌ Failed to flush chunk ${chunkIndex} for run ${tracked.runId}: ${getErrorMessage(err)}`
      );
      return;
    }
  }
}

async function flushFinalChunks(ctx: SpawnCtx, tracked: RunningProcess, runId: any): Promise<void> {
  await flushTailV2(ctx, tracked, true); // final flush: always sync the tail, even if unobserved
  if (consumePendingFullSync(tracked.runId)) {
    await appendFullOutputChunks(ctx, tracked, runId);
  }
}

/** One-shot full log sync when the webapp requests "Load more" on an active run. */
// fallow-ignore-next-line unused-export
export async function syncFullOutputOnRequest(
  ctx: SpawnCtx,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
  if (!consumePendingFullSync(tracked.runId)) return;

  await appendFullOutputChunks(ctx, tracked, runId);

  try {
    await ctx.deps.backend.mutation(api.commands.clearPendingFullOutputSync, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to clear pending full sync for ${tracked.runId}: ${getErrorMessage(err)}`
    );
  }
}

// fallow-ignore-next-line unused-export
export async function pollPendingFullOutputSyncs(ctx: SpawnCtx): Promise<void> {
  for (const [runId, tracked] of processManager.getAll()) {
    if (consumePendingFullSync(runId)) {
      await syncFullOutputOnRequest(ctx, tracked, runId as any);
    }
  }
}

export async function spawnCommandProcess(
  ctx: SpawnCtx,
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
      flushTailV2(ctx, tracked).catch(() => {});
      syncFullOutputOnRequest(ctx, tracked, runId).catch(() => {});
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

    const status = deriveTerminalStatus(code, signal, tracked.terminationIntent);

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
      `[${formatTimestamp()}] 📋 Command exited: ${commandName} (code=${code}, signal=${signal})`
    );
    finalize(code, signal as NodeJS.Signals | null).catch(() => {});
  });

  child.on('error', async (err) => {
    console.error(`[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`);
    finalize(null, null).catch(() => {});
  });

  return tracked;
}
