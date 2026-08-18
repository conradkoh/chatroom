import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireLockWithRetry, getPidFilePath, isDaemonRunning, releaseLock } from './pid.js';
import { getConvexUrl } from '../../infrastructure/convex/client.js';

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('https://chatroom-cloud.duskfare.com'),
}));

const CHATROOM_DIR = join(homedir(), '.chatroom');

describe('pid lock', () => {
  let pidPath: string;
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.mocked(getConvexUrl).mockReturnValue('https://chatroom-cloud.duskfare.com');
    if (!existsSync(CHATROOM_DIR)) {
      mkdirSync(CHATROOM_DIR, { recursive: true, mode: 0o700 });
    }
    pidPath = getPidFilePath();
    if (existsSync(pidPath)) {
      unlinkSync(pidPath);
    }
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) as {
      mockRestore: () => void;
    };
  });

  afterEach(() => {
    if (existsSync(pidPath)) {
      unlinkSync(pidPath);
    }
    errorSpy.mockRestore();
  });

  it('acquires lock when no PID file exists', async () => {
    const acquired = await acquireLockWithRetry({
      intervalMs: 1,
      maxWaitMs: 10,
      sleep: async () => {},
      listMatchingDaemonPids: () => [],
    });
    expect(acquired).toBe(true);
    expect(readFileSync(pidPath, 'utf-8')).toBe(String(process.pid));
  });

  it('reports running when current process holds the lock', async () => {
    writeFileSync(pidPath, String(process.pid), 'utf-8');

    expect(isDaemonRunning()).toEqual({ running: true, pid: process.pid });

    const acquired = await acquireLockWithRetry({
      intervalMs: 1,
      maxWaitMs: 5,
      sleep: async () => {},
      listMatchingDaemonPids: () => [],
    });
    expect(acquired).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      `⏳ Waiting for previous daemon to shut down for https://chatroom-cloud.duskfare.com (PID: ${process.pid})...`
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `❌ Daemon already running for https://chatroom-cloud.duskfare.com (PID: ${process.pid})`
    );
  });

  it('stops a leftover PID-file daemon then acquires the lock', async () => {
    const leftoverPid = 61_811;
    writeFileSync(pidPath, String(leftoverPid), 'utf-8');

    const live = new Set([leftoverPid]);
    const signals: (NodeJS.Signals | 0)[] = [];

    const acquired = await acquireLockWithRetry({
      intervalMs: 10,
      maxWaitMs: 100,
      sleep: async () => {},
      listMatchingDaemonPids: () => [],
      isRunning: (pid) => live.has(pid),
      signal: (pid, signal) => {
        signals.push(signal);
        if (pid === leftoverPid && (signal === 'SIGTERM' || signal === 'SIGKILL')) {
          live.delete(pid);
        }
      },
    });

    expect(acquired).toBe(true);
    expect(signals).toContain('SIGTERM');
    expect(errorSpy).toHaveBeenCalledWith(`Stopping previous daemon (PID: ${leftoverPid})...`);
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('❌ Daemon already running'));
    expect(readFileSync(pidPath, 'utf-8')).toBe(String(process.pid));
  });

  it('fails once after max wait when lock remains held', async () => {
    writeFileSync(pidPath, String(process.pid), 'utf-8');

    const acquired = await acquireLockWithRetry({
      intervalMs: 1,
      maxWaitMs: 5,
      sleep: async () => {},
      listMatchingDaemonPids: () => [],
    });

    expect(acquired).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      `⏳ Waiting for previous daemon to shut down for https://chatroom-cloud.duskfare.com (PID: ${process.pid})...`
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `❌ Daemon already running for https://chatroom-cloud.duskfare.com (PID: ${process.pid})`
    );
  });

  it('releaseLock removes the PID file', () => {
    writeFileSync(pidPath, String(process.pid), 'utf-8');
    releaseLock();
    expect(existsSync(pidPath)).toBe(false);
  });

  it('replaces leftover daemons for this Convex URL before taking the lock', async () => {
    const leftoverPid = 61_902;
    const scannedPid = 61_903;
    writeFileSync(pidPath, String(leftoverPid), 'utf-8');

    const live = new Set([leftoverPid, scannedPid]);
    const signals: { pid: number; signal: NodeJS.Signals | 0 }[] = [];

    const acquired = await acquireLockWithRetry({
      intervalMs: 1,
      maxWaitMs: 50,
      sleep: async () => {},
      listMatchingDaemonPids: () => [scannedPid],
      isRunning: (pid) => live.has(pid),
      signal: (pid, signal) => {
        signals.push({ pid, signal });
        if (signal === 'SIGTERM' || signal === 'SIGKILL') live.delete(pid);
      },
    });

    expect(acquired).toBe(true);
    expect(signals).toEqual(
      expect.arrayContaining([
        { pid: leftoverPid, signal: 'SIGTERM' },
        { pid: scannedPid, signal: 'SIGTERM' },
      ])
    );
    expect(readFileSync(pidPath, 'utf-8')).toBe(String(process.pid));
    expect(errorSpy).toHaveBeenCalledWith(`Stopping previous daemon (PID: ${leftoverPid})...`);
    expect(errorSpy).toHaveBeenCalledWith(`Stopping previous daemon (PID: ${scannedPid})...`);
  });
});
