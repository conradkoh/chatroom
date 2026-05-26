import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BufferedJournalFactory } from './journal-factory.js';
import type {
  OutputRepository,
  OutputChunk,
} from '../../domain/direct-harness/ports/output-repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockOutputRepository(): OutputRepository {
  return {
    appendChunks: vi.fn().mockResolvedValue(undefined),
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
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 1000,
      logger: { warn: warnSpy },
    });

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
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

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
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

    factory.create('row-1');

    // Advance past many intervals
    await vi.advanceTimersByTimeAsync(2000);

    // Should not have tried to flush anything
    expect(repo.appendChunks).not.toHaveBeenCalled();
  });

  it('stops the interval after commit', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

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
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

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
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0][1][0].content).toBe(
      'part1'
    );
    // Second call: part2
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[1][1]).toHaveLength(1);
    expect((repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[1][1][0].content).toBe(
      'part2'
    );
  });

  it('re-queues chunks on flush failure and logs a warning', async () => {
    const repo = mockOutputRepository();
    (repo.appendChunks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

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
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    await journal.commit();

    expect(repo.appendChunks).not.toHaveBeenCalled();
  });

  it('passes chunk content and timestamp to the output repository', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 1000,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    journal.record({ content: 'a', timestamp: 1 });
    journal.record({ content: 'b', timestamp: 2 });
    journal.record({ content: 'c', timestamp: 3 });
    await journal.commit();

    const chunks: OutputChunk[] = (repo.appendChunks as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ content: 'a', timestamp: 1 });
    expect(chunks[1]).toMatchObject({ content: 'b', timestamp: 2 });
    expect(chunks[2]).toMatchObject({ content: 'c', timestamp: 3 });
  });

  it('defaults flushIntervalMs to 500ms when not specified', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    journal.record({ content: 'tick', timestamp: 100 });

    // Just under 500ms — interval should not have fired yet.
    await vi.advanceTimersByTimeAsync(400);
    expect(repo.appendChunks).not.toHaveBeenCalled();

    // Past 500ms — should now have flushed.
    await vi.advanceTimersByTimeAsync(150);
    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
  });

  it('logs a per-chunk trace on record() with session, messageId, partType, and bytes', () => {
    const repo = mockOutputRepository();
    const logSpy = vi.fn();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy, log: logSpy },
    });

    const journal = factory.create('row-xyz');
    journal.record({
      content: 'hello world',
      timestamp: 100,
      messageId: 'msg_42',
      partType: 'reasoning',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('[journal] chunk recorded');
    expect(line).toContain('session=row-xyz');
    expect(line).toContain('messageId=msg_42');
    expect(line).toContain('partType=reasoning');
    expect(line).toContain('bytes=11');
  });

  // ─── flush() ────────────────────────────────────────────────────────────────

  it('flush() drains the buffer immediately without stopping the interval', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 1000,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    journal.record({ content: 'immediate', timestamp: 100 });

    // Flush before interval fires
    await journal.flush();

    expect(repo.appendChunks).toHaveBeenCalledTimes(1);
    expect(repo.appendChunks).toHaveBeenCalledWith(
      'row-1',
      expect.arrayContaining([expect.objectContaining({ content: 'immediate' })])
    );

    // Interval should still be running — add another chunk and advance time
    journal.record({ content: 'later', timestamp: 200 });
    await vi.advanceTimersByTimeAsync(1100);

    expect(repo.appendChunks).toHaveBeenCalledTimes(2);
  });

  it('flush() is a no-op when buffer is empty and no flush is in flight', async () => {
    const repo = mockOutputRepository();
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 1000,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    await journal.flush();

    expect(repo.appendChunks).not.toHaveBeenCalled();
  });

  it('flush() waits for in-flight periodic flush when buffer is already empty', async () => {
    let resolveAppend!: () => void;
    const appendPromise = new Promise<void>((resolve) => {
      resolveAppend = resolve;
    });
    const repo: OutputRepository = {
      appendChunks: vi.fn().mockImplementation(() => appendPromise),
    };
    const factory = new BufferedJournalFactory({
      outputRepository: repo,
      flushIntervalMs: 500,
      logger: { warn: warnSpy },
    });

    const journal = factory.create('row-1');
    journal.record({ content: 'inflight', timestamp: 100 });

    await vi.advanceTimersByTimeAsync(500);
    expect(repo.appendChunks).toHaveBeenCalledTimes(1);

    let flushDone = false;
    const flushPromise = journal.flush().then(() => {
      flushDone = true;
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(flushDone).toBe(false);

    resolveAppend();
    await vi.advanceTimersByTimeAsync(20);
    await flushPromise;
    expect(flushDone).toBe(true);
  });
});
