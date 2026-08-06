import type { ChildProcess } from 'node:child_process';

import { processManager } from './manager.js';
import type { RunningProcess } from './state.js';
import { SIGTERM_GRACE_PERIOD_MS } from './state.js';
import { formatTimestamp } from '../../../../commands/machine/daemon-start/utils.js';

export function killProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already dead
  }
}

export async function killTrackedProcess(tracked: RunningProcess): Promise<void> {
  killProcess(tracked.process, 'SIGTERM');
  const exited = await processManager.waitForExit(tracked.runId, SIGTERM_GRACE_PERIOD_MS);
  if (!exited) {
    console.log(`[${formatTimestamp()}] 🔪 Force-killing process: ${tracked.runId}`);
    killProcess(tracked.process, 'SIGKILL');
    await processManager.waitForExit(tracked.runId, 1_000);
  }
}
