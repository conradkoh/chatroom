import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import { LISTENING_URL_RE, waitForListeningUrl } from './parse-listening-url.js';

function makeFakeChild(pid = 4321): ChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & ChildProcess;
  Object.defineProperty(child, 'pid', { value: pid });
  (child as unknown as { stdout: EventEmitter }).stdout = stdout;
  (child as unknown as { stderr: EventEmitter }).stderr = stderr;
  return child as unknown as ChildProcess;
}

describe('waitForListeningUrl', () => {
  describe('LISTENING_URL_RE', () => {
    it('matches the canonical listening line', () => {
      const line = 'opencode server listening on http://127.0.0.1:5678';
      const match = line.match(LISTENING_URL_RE);
      expect(match?.[1]).toBe('http://127.0.0.1:5678');
    });

    it('matches with trailing punctuation (stripped)', () => {
      const line = 'opencode server listening on http://127.0.0.1:5678.';
      const match = line.match(LISTENING_URL_RE);
      expect(match?.[1]).toBe('http://127.0.0.1:5678');
    });
  });

  describe('waitForListeningUrl', () => {
    it('resolves when stdout emits the listening line', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.stdout!.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await expect(promise).resolves.toBe('http://127.0.0.1:5678');
    });

    it('resolves when stderr emits the listening line', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.stderr!.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await expect(promise).resolves.toBe('http://127.0.0.1:5678');
    });

    it('ignores unrelated URLs and resolves on the real listening line', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.stdout!.emit(
        'data',
        Buffer.from('upgrade available at https://opencode.ai/releases/v1.0\n')
      );
      child.stdout!.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await expect(promise).resolves.toBe('http://127.0.0.1:5678');
    });

    it('handles URL line split across chunks', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.stdout!.emit('data', Buffer.from('opencode server listening on http://127.0.0.'));
      child.stdout!.emit('data', Buffer.from('1:5678\n'));
      await expect(promise).resolves.toBe('http://127.0.0.1:5678');
    });

    it('rejects with code and signal when child exits during startup', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.emit('exit', 1, null);
      await expect(promise).rejects.toThrow(/exited unexpectedly/);
      await expect(promise).rejects.toThrow(/code=1/);
      await expect(promise).rejects.toThrow(/signal=null/);
    });

    it('rejects with timeout message', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild();
        const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
        const settled = promise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(5001);
        const err = await settled;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toMatch(/did not print a listening URL/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cleans up listeners after happy-path resolve', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.stdout!.emit(
        'data',
        Buffer.from('opencode server listening on http://127.0.0.1:5678\n')
      );
      await promise;
      expect(child.stdout!.listenerCount('data')).toBe(0);
      expect(child.listenerCount('exit')).toBe(0);
    });

    it('cleans up listeners after exit rejection', async () => {
      const child = makeFakeChild();
      const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
      child.emit('exit', 1, null);
      await expect(promise).rejects.toThrow(/exited unexpectedly/);
      expect(child.stdout!.listenerCount('data')).toBe(0);
      expect(child.listenerCount('exit')).toBe(0);
    });

    it('cleans up listeners after timeout rejection', async () => {
      vi.useFakeTimers();
      try {
        const child = makeFakeChild();
        const promise = waitForListeningUrl(child, { timeoutMs: 5000 });
        const settled = promise.catch((e) => e);
        await vi.advanceTimersByTimeAsync(5001);
        await settled;
        expect(child.stdout!.listenerCount('data')).toBe(0);
        expect(child.listenerCount('exit')).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
