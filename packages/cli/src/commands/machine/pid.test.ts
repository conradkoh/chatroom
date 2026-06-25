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
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(getConvexUrl).mockReturnValue('https://chatroom-cloud.duskfare.com');
    if (!existsSync(CHATROOM_DIR)) {
      mkdirSync(CHATROOM_DIR, { recursive: true, mode: 0o700 });
    }
    pidPath = getPidFilePath();
    if (existsSync(pidPath)) {
      unlinkSync(pidPath);
    }
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    });
    expect(acquired).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      `⏳ Waiting for previous daemon to shut down for https://chatroom-cloud.duskfare.com (PID: ${process.pid})...`
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `❌ Daemon already running for https://chatroom-cloud.duskfare.com (PID: ${process.pid})`
    );
  });

  it('retries until the previous daemon releases the lock', async () => {
    const stalePid = 61_811;
    writeFileSync(pidPath, String(stalePid), 'utf-8');

    let running = true;
    const isRunningSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === stalePid && signal === 0 && !running) {
        throw new Error('ESRCH');
      }
      return true;
    });

    const sleep = vi.fn(async (ms: number) => {
      if (sleep.mock.calls.length === 1) {
        running = false;
      }
      await Promise.resolve();
      void ms;
    });

    const acquired = await acquireLockWithRetry({
      intervalMs: 10,
      maxWaitMs: 100,
      sleep,
    });

    expect(acquired).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      `⏳ Waiting for previous daemon to shut down for https://chatroom-cloud.duskfare.com (PID: ${stalePid})...`
    );
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('❌ Daemon already running'));
    expect(readFileSync(pidPath, 'utf-8')).toBe(String(process.pid));

    isRunningSpy.mockRestore();
  });

  it('fails once after max wait when lock remains held', async () => {
    writeFileSync(pidPath, String(process.pid), 'utf-8');

    const acquired = await acquireLockWithRetry({
      intervalMs: 1,
      maxWaitMs: 5,
      sleep: async () => {},
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
});
