/**
 * Process Driver Unit Tests
 *
 * Tests for the SIGKILL fallback in ProcessDriver.stop():
 * - SIGTERM is sent first, process exits gracefully
 * - SIGKILL is sent after timeout if process doesn't exit
 */

import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { ProcessDriver, type SpawnConfig } from './process-driver.js';
import type { AgentCapabilities, AgentHandle, AgentStartOptions } from './types.js';

/**
 * Concrete test subclass of ProcessDriver.
 * Only needed to instantiate the abstract class for testing stop().
 */
class TestProcessDriver extends ProcessDriver {
  readonly harness = 'opencode' as const;
  readonly capabilities: AgentCapabilities = {
    sessionPersistence: false,
    abort: false,
    modelSelection: false,
    compaction: false,
    eventStreaming: false,
    messageInjection: false,
    dynamicModelDiscovery: false,
  };

  protected buildSpawnConfig(_options: AgentStartOptions): SpawnConfig {
    return {
      command: 'echo',
      args: ['test'],
      stdio: 'ignore',
      writePromptToStdin: false,
    };
  }
}

/**
 * Helper to spawn a sleep process and return its PID.
 * Uses `sleep` on Unix which responds to SIGTERM.
 */
function spawnSleepProcess(seconds: number): number {
  const child = spawn('sleep', [String(seconds)], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error('Failed to spawn sleep process');
  return pid;
}

/**
 * Check if a process is alive by sending signal 0.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('ProcessDriver.stop()', () => {
  it('sends SIGTERM and process exits gracefully', async () => {
    const driver = new TestProcessDriver();
    const pid = spawnSleepProcess(60); // Long sleep — will be killed by SIGTERM

    // Verify process is alive
    expect(isProcessAlive(pid)).toBe(true);

    const handle: AgentHandle = {
      harness: 'opencode',
      type: 'process',
      pid,
      workingDir: '/tmp',
    };

    // stop() should send SIGTERM and the sleep process should exit
    await driver.stop(handle);

    // Process should be dead after stop()
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('sends SIGKILL after timeout if process ignores SIGTERM', async () => {
    const driver = new TestProcessDriver();

    // Spawn a process that traps SIGTERM (ignores it)
    // Use bash -c with trap to ignore SIGTERM, exec sleep to replace bash
    // so SIGKILL goes directly to the sleep process
    const child = spawn('bash', ['-c', 'trap "" TERM; while true; do sleep 1; done'], {
      stdio: 'ignore',
      detached: false, // Keep in same process group so we can kill it
    });
    const pid = child.pid;
    if (!pid) throw new Error('Failed to spawn trap process');

    // Give it a moment to set up the trap
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify process is alive
    expect(isProcessAlive(pid)).toBe(true);

    const handle: AgentHandle = {
      harness: 'opencode',
      type: 'process',
      pid,
      workingDir: '/tmp',
    };

    // stop() should send SIGTERM, wait 5s, then SIGKILL
    // This will take ~5 seconds
    await driver.stop(handle);

    // Give OS a moment to clean up
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Process should be dead after SIGKILL
    expect(isProcessAlive(pid)).toBe(false);
  }, 15_000); // 15s timeout for this test

  it('succeeds silently when process is already dead (ESRCH)', async () => {
    const driver = new TestProcessDriver();
    const pid = spawnSleepProcess(60);

    // Kill the process before calling stop()
    process.kill(pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isProcessAlive(pid)).toBe(false);

    const handle: AgentHandle = {
      harness: 'opencode',
      type: 'process',
      pid,
      workingDir: '/tmp',
    };

    // stop() should not throw — ESRCH is handled gracefully
    await expect(driver.stop(handle)).resolves.toBeUndefined();
  });

  it('throws if handle has no PID', async () => {
    const driver = new TestProcessDriver();

    const handle: AgentHandle = {
      harness: 'opencode',
      type: 'session', // Not a process handle
      workingDir: '/tmp',
    };

    await expect(driver.stop(handle)).rejects.toThrow(/Cannot stop/);
  });
});
