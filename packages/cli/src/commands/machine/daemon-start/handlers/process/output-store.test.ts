import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { createOutputStore, ensureTempDir, cleanOrphanTempFiles, TAIL_WINDOW_BYTES } from './output-store';

describe('createOutputStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runId validation', () => {
    it('accepts valid alphanumeric runIds', () => {
      expect(() => createOutputStore('abc123')).not.toThrow();
      expect(() => createOutputStore('jd74mfyjznnsqb223e0w0gp15h87azd7')).not.toThrow();
    });

    it('rejects runIds with special characters', () => {
      expect(() => createOutputStore('../evil')).toThrow(/Invalid runId/);
      expect(() => createOutputStore('run-id!')).toThrow(/Invalid runId/);
    });
  });

  describe('append and getTail', () => {
    it('accumulates content and returns tail', async () => {
      const store = createOutputStore('test1');
      await store.append('hello ');
      await store.append('world');
      const tail = store.getTail();
      expect(tail.content).toBe('hello world');
      expect(tail.totalBytes).toBe(11);
    });

    it('appends data to the file', async () => {
      const store = createOutputStore('test2');
      await store.append('data');
      expect(appendFile).toHaveBeenCalled();
    });

    it('handles file write failure gracefully', async () => {
      vi.mocked(appendFile).mockRejectedValueOnce(new Error('disk full'));
      const store = createOutputStore('test3');
      await store.append('still works');
      const tail = store.getTail();
      expect(tail.content).toBe('still works');
    });
  });

  describe('tail windowing', () => {
    it('caps tail at TAIL_WINDOW_BYTES', async () => {
      const store = createOutputStore('test4');
      const big = 'x'.repeat(TAIL_WINDOW_BYTES + 5000);
      await store.append(big);
      const tail = store.getTail();
      expect(tail.content.length).toBe(TAIL_WINDOW_BYTES);
      expect(tail.content).toBe(big.slice(-TAIL_WINDOW_BYTES));
    });

    it('maintains totalBytes across append calls', async () => {
      const store = createOutputStore('test5');
      await store.append('a'.repeat(1000));
      await store.append('b'.repeat(1000));
      const tail = store.getTail();
      expect(tail.totalBytes).toBe(2000);
    });
  });

  describe('getFullOutput', () => {
    it('reads full content from temp file', async () => {
      vi.mocked(readFile).mockResolvedValue('full file content');
      const store = createOutputStore('test6');
      const output = await store.getFullOutput();
      expect(output).toBe('full file content');
    });

    it('falls back to in-memory tail on file read failure', async () => {
      vi.mocked(readFile).mockRejectedValueOnce(new Error('file not found'));
      const store = createOutputStore('test7');
      await store.append('in-memory fallback');
      const output = await store.getFullOutput();
      expect(output).toBe('in-memory fallback');
    });
  });

  describe('destroy', () => {
    it('removes the temp file', async () => {
      const store = createOutputStore('test8');
      await store.destroy();
      expect(rm).toHaveBeenCalled();
    });

    it('handles destroy failure gracefully', async () => {
      vi.mocked(rm).mockRejectedValueOnce(new Error('permission denied'));
      const store = createOutputStore('test9');
      await expect(store.destroy()).resolves.toBeUndefined();
    });
  });
});

describe('ensureTempDir', () => {
  it('creates temp directory recursively', async () => {
    await ensureTempDir();
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('chatroom-cli'), { recursive: true });
  });
});

describe('cleanOrphanTempFiles', () => {
  it('removes the temp directory', async () => {
    await cleanOrphanTempFiles();
    expect(rm).toHaveBeenCalled();
  });

  it('handles missing directory gracefully', async () => {
    vi.mocked(rm).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(cleanOrphanTempFiles()).resolves.toBeUndefined();
  });
});
