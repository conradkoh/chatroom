/**
 * orphan-tracker Unit + Integration Tests
 *
 * Uses a temporary HOME directory to avoid polluting the real ~/.chatroom.
 */

import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module under test (imported after HOME is set in beforeEach) ────────────
// We import lazily via vi.importActual() inside tests that need the real module
// so the HOME env override is picked up.
//
// For unit tests we import the module directly — the module reads HOME at
// call-time (via homedir()), so patching process.env.HOME before each test is
// sufficient.

import {
  clearTrackedPids,
  getChildPidsFilePath,
  reapOrphanedProcessGroups,
  trackChildPid,
  untrackChildPid,
} from './orphan-tracker.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock convex client so getConvexUrl() returns a stable test URL
vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

let originalHome: string | undefined;
let testHome: string;

beforeEach(() => {
  // Redirect HOME to a fresh temp dir so tests don't pollute ~/.chatroom
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `orphan-tracker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
});

afterEach(() => {
  // Restore HOME
  process.env.HOME = originalHome;
});

// ─── A. trackChildPid / untrackChildPid ──────────────────────────────────────

describe('trackChildPid / untrackChildPid', () => {
  it('writes a PID to the file and reads it back', () => {
    trackChildPid(12345);
    const content = readFileSync(getChildPidsFilePath(), 'utf-8');
    expect(content).toContain('12345');
  });

  it('appends multiple PIDs in order', () => {
    trackChildPid(1001);
    trackChildPid(1002);
    trackChildPid(1003);
    const content = readFileSync(getChildPidsFilePath(), 'utf-8');
    const lines = content.split('\n').filter(Boolean).map(Number);
    expect(lines).toEqual([1001, 1002, 1003]);
  });

  it('removes the given PID from the file', () => {
    trackChildPid(2001);
    trackChildPid(2002);
    trackChildPid(2003);
    untrackChildPid(2002);
    const content = readFileSync(getChildPidsFilePath(), 'utf-8');
    const lines = content.split('\n').filter(Boolean).map(Number);
    expect(lines).toEqual([2001, 2003]);
    expect(lines).not.toContain(2002);
  });

  it('untrackChildPid for a non-existent PID is a no-op', () => {
    trackChildPid(3001);
    // Should not throw
    expect(() => untrackChildPid(9999)).not.toThrow();
    const content = readFileSync(getChildPidsFilePath(), 'utf-8');
    expect(content).toContain('3001');
  });

  it('untrackChildPid when file does not exist is a no-op', () => {
    // File doesn't exist yet
    expect(existsSync(getChildPidsFilePath())).toBe(false);
    expect(() => untrackChildPid(4001)).not.toThrow();
  });
});

// ─── B. clearTrackedPids ─────────────────────────────────────────────────────

describe('clearTrackedPids', () => {
  it('removes the pids file', () => {
    trackChildPid(5001);
    expect(existsSync(getChildPidsFilePath())).toBe(true);
    clearTrackedPids();
    expect(existsSync(getChildPidsFilePath())).toBe(false);
  });

  it('calling again when file is already gone is a no-op', () => {
    expect(() => clearTrackedPids()).not.toThrow();
  });
});

// ─── C. reapOrphanedProcessGroups — unit (no real processes) ─────────────────

describe('reapOrphanedProcessGroups — unit', () => {
  it('returns { reaped: 0, checked: 0 } when file is missing', async () => {
    const result = await reapOrphanedProcessGroups();
    expect(result).toEqual({ reaped: 0, checked: 0 });
  });

  it('returns { reaped: 0, checked: 0 } when file is empty', async () => {
    // Write an empty file
    trackChildPid(0); // pid 0 will be filtered as invalid
    clearTrackedPids();
    const result = await reapOrphanedProcessGroups();
    expect(result).toEqual({ reaped: 0, checked: 0 });
  });

  it('skips already-dead PIDs and returns reaped=0 for them', async () => {
    // PID 2 is always the kernel on Linux/macOS and can't be killed, but
    // a made-up large PID like 9999999 is almost certainly dead.
    trackChildPid(9999999);
    const result = await reapOrphanedProcessGroups();
    // ESRCH → already dead → not reaped
    expect(result.checked).toBe(1);
    expect(result.reaped).toBe(0);
    // File should be cleared regardless
    expect(existsSync(getChildPidsFilePath())).toBe(false);
  });
});

// ─── D. Integration test — real process tree ─────────────────────────────────

describe('reapOrphanedProcessGroups — integration (real process tree)', () => {
  it('reaps a real orphaned detached process group and clears the pids file', async () => {
    if (process.platform === 'win32') return;

    const { spawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');

    // Spawn a real detached child (simulating a process left over from a crashed daemon)
    const child = spawn('sh', ['-c', 'sleep 30'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref(); // Don't keep the test process alive

    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);

    // Wait briefly for the process to start
    await new Promise<void>((r) => setTimeout(r, 100));

    // Verify it's alive
    expect(() => process.kill(pid, 0)).not.toThrow();

    // Write it to the pids file (simulating what trackChildPid does on spawn)
    trackChildPid(pid);
    expect(existsSync(getChildPidsFilePath())).toBe(true);

    // Reap orphans — should kill the process group
    const result = await reapOrphanedProcessGroups();

    expect(result.reaped).toBeGreaterThanOrEqual(1);
    expect(result.checked).toBeGreaterThanOrEqual(1);

    // The child process should now be dead
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();

    // Pids file should be cleaned up
    expect(existsSync(getChildPidsFilePath())).toBe(false);
  }, 10_000);
});
