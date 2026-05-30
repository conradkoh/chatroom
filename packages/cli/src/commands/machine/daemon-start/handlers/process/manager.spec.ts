import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from './manager.js';
import type { RunningProcess } from './state.js';

function makeMockProcess(overrides: Partial<RunningProcess> = {}): RunningProcess {
  return {
    process: { pid: 12345 } as any,
    runId: 'run-1',
    commandKey: 'machine|/dir|cmd',
    store: {
      append: vi.fn().mockResolvedValue(undefined),
      getTail: vi.fn().mockReturnValue({ content: '', totalBytes: 0 }),
      getLastNLines: vi.fn().mockResolvedValue({ content: '', totalBytes: 0, lineCount: 0 }),
      getFullOutput: vi.fn().mockResolvedValue(''),
      destroy: vi.fn().mockResolvedValue(undefined),
    },
    startedAt: Date.now(),
    flushTimer: { ref: vi.fn(), unref: vi.fn() } as any,
    softTimeoutTimer: null,
    terminationIntent: null,
    ...overrides,
  };
}

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  describe('register / has / get', () => {
    it('registers and retrieves a process by runId', () => {
      const proc = makeMockProcess();
      pm.register('run-1', 'key-1', proc);
      expect(pm.has('run-1')).toBe(true);
      expect(pm.get('run-1')).toBe(proc);
    });

    it('returns undefined for unknown runId', () => {
      expect(pm.has('unknown')).toBe(false);
      expect(pm.get('unknown')).toBeUndefined();
    });
  });

  describe('getByCommand', () => {
    it('retrieves a process by command key', () => {
      const proc = makeMockProcess();
      pm.register('run-1', 'key-1', proc);
      expect(pm.getByCommand('key-1')).toBe(proc);
    });

    it('returns undefined for unknown command key', () => {
      expect(pm.getByCommand('unknown')).toBeUndefined();
    });

    it('returns undefined when command key points to a deleted run', () => {
      const proc = makeMockProcess();
      pm.register('run-1', 'key-1', proc);
      pm.unregister('run-1', 'key-1');
      expect(pm.getByCommand('key-1')).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('removes process from both maps', () => {
      const proc = makeMockProcess();
      pm.register('run-1', 'key-1', proc);
      pm.unregister('run-1', 'key-1');
      expect(pm.has('run-1')).toBe(false);
      expect(pm.getByCommand('key-1')).toBeUndefined();
    });

    it('does not remove command key if it was replaced with a newer run', () => {
      const proc1 = makeMockProcess({ runId: 'run-1' });
      const proc2 = makeMockProcess({ runId: 'run-2' });
      pm.register('run-1', 'key-1', proc1);
      // Replace the command mapping with a new run
      pm.register('run-2', 'key-1', proc2);
      // Now unregister the old run
      pm.unregister('run-1', 'key-1');
      // Command key should still point to run-2
      expect(pm.getByCommand('key-1')).toBe(proc2);
    });
  });

  describe('pending stops', () => {
    it('marks, checks, and consumes a pending stop', () => {
      pm.markPendingStop('run-1');
      expect(pm.consumePendingStop('run-1')).toBe(true);
      expect(pm.consumePendingStop('run-1')).toBe(false);
    });

    it('returns false for consuming an unregistered stop', () => {
      expect(pm.consumePendingStop('unknown')).toBe(false);
    });

    it('evicts stale pending stops', () => {
      vi.useFakeTimers();
      pm.markPendingStop('run-1');
      vi.advanceTimersByTime(61_000);
      pm.evictStalePendingStops();
      expect(pm.consumePendingStop('run-1')).toBe(false);
      vi.useRealTimers();
    });

    it('keeps recent pending stops after eviction', () => {
      vi.useFakeTimers();
      pm.markPendingStop('run-1');
      pm.evictStalePendingStops();
      expect(pm.consumePendingStop('run-1')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('getAll / size / clear', () => {
    it('returns all entries', () => {
      pm.register('run-1', 'key-1', makeMockProcess({ runId: 'run-1' }));
      pm.register('run-2', 'key-2', makeMockProcess({ runId: 'run-2' }));
      expect(pm.size).toBe(2);
      expect(pm.getAll()).toHaveLength(2);
    });

    it('clears all entries', () => {
      pm.register('run-1', 'key-1', makeMockProcess({ runId: 'run-1' }));
      pm.clear();
      expect(pm.size).toBe(0);
      expect(pm.getAll()).toHaveLength(0);
    });
  });

  describe('waitForExit', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves true when process exits before timeout', async () => {
      const proc = makeMockProcess();
      pm.register('run-1', 'key-1', proc);

      const waitPromise = pm.waitForExit('run-1', 1000);
      pm.unregister('run-1', 'key-1');
      vi.advanceTimersByTime(200);

      await expect(waitPromise).resolves.toBe(true);
    });

    it('resolves false when timeout is reached', async () => {
      pm.register('run-1', 'key-1', makeMockProcess());

      const waitPromise = pm.waitForExit('run-1', 300);
      vi.advanceTimersByTime(400);

      await expect(waitPromise).resolves.toBe(false);
    });
  });
});
