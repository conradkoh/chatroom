import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BufferedJournalFactory } from './journal-factory.js';
import type { OutputRepository, OutputChunk } from '../../domain/direct-harness/ports/output-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockOutputRepository(): OutputRepository {
  return {
    appendChunks: vi.fn().mockResolvedValue(undefined),
    updateTitle: vi.fn(),
  };
}

const warnSpy = vi.fn();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BufferedJournalFactory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records chunks and commits them', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 1000, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'hello', timestamp: 100 });
    journal.record({ content: 'world', timestamp: 200 });
    await journal.commit();

    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
    const args = (repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toBe('row-1');
    expect(args[1]).toHaveLength(2);
    expect(args[1][0].content).toBe('hello');
    expect(args[1][1].content).toBe('world');
  });

  it('flushes chunks periodically via interval', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'stream', timestamp: 100 });

    // Advance time past the flush interval
    await vi.advanceTimersByTimeAsync(600);

    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
    expect(repo.appendChunks).toHaveBeenCalledWith(
      'row-1',
      expect.arrayContaining([expect.objectContaining({ content: 'stream' })])
    );
  });

  it('does not flush on interval when buffer is empty', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    factory.create('row-1');

    // Advance past many intervals
    await vi.advanceTimersByTimeAsync(2000);

    // Should not have tried to flush anything
    expect(repo.appendChunks).not.toHaveBeenCalled();
  });

  it('stops the interval after commit', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'before', timestamp: 100 });

    // Commit flushes the 'before' chunk
    await journal.commit();
    expect(repo.appendChunks).toHaveBeenCalledTimes(1);

    // Record after commit — buffer has it but interval is stopped
    journal.record({ content: 'after', timestamp: 200 });
    await vi.advanceTimersByTimeAsync(1000);

    // Interval should NOT have fired again after commit
    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
  });

  it('also flushes via interval AND via commit', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'part1', timestamp: 100 });

    // First interval flush
    await vi.advanceTimersByTimeAsync(600);

    journal.record({ content: 'part2', timestamp: 200 });

    // Commit should flush the remaining chunk
    await journal.commit();

    expect(repo.appendChunks).toHaveBeenCalledTimes(2);
    // First call: part1
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(1);
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0][1][0].content).toBe('part1');
    // Second call: part2
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[1][1]).toHaveLength(1);
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[1][1][0].content).toBe('part2');
  });

  it('re-queues chunks on flush failure and logs a warning', async () => {
    const repo = mockOutputRepository();
    (repo.appendChunks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'fragile', timestamp: 100 });

    // Trigger the interval flush
    await vi.advanceTimersByTimeAsync(600);

    // Should have attempted to flush and logged a warning
    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    // The chunk should still be available in the next flush attempt
    // After another interval, it tries again
    await vi.advanceTimersByTimeAsync(500);
    expect(repo.appendChunks).toHaveBeenCalledTimes(2);
  });

  it('commit works when no chunks were recorded', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 500, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    await journal.commit();

    expect(repo.appendChunks).not.toHaveBeenCalled();
  });

  it('assigns sequential seq numbers to chunks', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({ outputRepository: repo, flushIntervalMs: 1000, logger: { warn: warnSpy } });

    const journal = factory.create('row-1');
    journal.record({ content: 'a', timestamp: 1 });
    journal.record({ content: 'b', timestamp: 2 });
    journal.record({ content: 'c', timestamp: 3 });
    await journal.commit();

    const chunks: OutputChunk[] = (repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(chunks[0].seq).toBe(1);
    expect(chunks[1].seq).toBe(2);
    expect(chunks[2].seq).toBe(3);
  });
});
