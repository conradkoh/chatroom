import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BufferedMessageStreamSink } from './buffered-sink.js';
import type { BufferedSinkOptions } from './buffered-sink.js';
import { IntervalFlushStrategy } from './strategies/interval-strategy.js';
import type { MessageStreamTransport, HarnessSessionRowId } from '../../../../domain/index.js';
import type { MessageStreamSinkWarning } from '../../../../domain/direct-harness/ports/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HARNESS_SESSION_ROW_ID = 'worker-test' as HarnessSessionRowId;

function createTransport(): { transport: MessageStreamTransport; persist: ReturnType<typeof vi.fn> } {
  const persist = vi.fn().mockResolvedValue(undefined);
  return { transport: { persist }, persist };
}

interface SinkFixture {
  sink: BufferedMessageStreamSink;
  transport: MessageStreamTransport;
  persist: ReturnType<typeof vi.fn>;
  clockMs: { value: number };
}

/** Create a sink with a controllable clock and fake-timer-compatible interval injection. */
function createSink(overrides: Partial<BufferedSinkOptions> = {}): SinkFixture {
  const clockMs = { value: 0 };
  const { transport, persist } = createTransport();
  const sink = new BufferedMessageStreamSink({
    workerId: HARNESS_SESSION_ROW_ID,
    transport,
    strategy: new IntervalFlushStrategy(500),
    tickIntervalMs: 100,
    maxBufferItems: 5,
    clock: () => clockMs.value,
    setIntervalFn: setInterval,
    clearIntervalFn: clearInterval,
    ...overrides,
  });
  return { sink, transport, persist, clockMs };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BufferedMessageStreamSink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  // ── write: seq assignment ──────────────────────────────────────────────────

  it('assigns monotonically increasing seq starting at 0', async () => {
    const { sink, persist } = createSink();
    sink.write({ content: 'a' });
    sink.write({ content: 'b' });
    sink.write({ content: 'c' });
    await sink.flush();
    expect(persist).toHaveBeenCalledOnce();
    const [, chunks] = persist.mock.calls[0];
    expect(chunks.map((c: any) => c.seq)).toEqual([0, 1, 2]);
  });

  it('seq is monotonically increasing across multiple flushes', async () => {
    const { sink, persist } = createSink();
    sink.write({ content: 'a' });
    await sink.flush();
    sink.write({ content: 'b' });
    await sink.flush();
    const firstChunks = persist.mock.calls[0][1] as any[];
    const secondChunks = persist.mock.calls[1][1] as any[];
    expect(firstChunks[0].seq).toBe(0);
    expect(secondChunks[0].seq).toBe(1);
  });

  // ── write: timestamp ───────────────────────────────────────────────────────

  it('assigns timestamp from the injected clock', async () => {
    const { sink, persist, clockMs } = createSink();
    clockMs.value = 42_000;
    sink.write({ content: 'timed' });
    await sink.flush();
    const [, chunks] = persist.mock.calls[0];
    expect(chunks[0].timestamp).toBe(42_000);
  });

  // ── timer-driven flush ─────────────────────────────────────────────────────

  it('flushes to transport when strategy threshold is reached via background tick', async () => {
    const { sink, persist, clockMs } = createSink();
    sink.write({ content: 'item' });

    // Simulate time passing past the interval (500ms) then tick
    clockMs.value = 600;
    await vi.advanceTimersByTimeAsync(200); // two ticks at 100ms each → evaluate() fires

    expect(persist).toHaveBeenCalledOnce();
    const [, chunks] = persist.mock.calls[0];
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('item');
  });

  // ── flush: buffer cleared + lastFlushAt updated ────────────────────────────

  it('clears buffer and updates lastFlushAt after successful flush', async () => {
    const { sink, persist, clockMs } = createSink();
    clockMs.value = 1000;
    sink.write({ content: 'x' });
    await sink.flush();
    expect(persist).toHaveBeenCalledOnce();
    // Second flush on an empty buffer should not call persist again
    await sink.flush();
    expect(persist).toHaveBeenCalledOnce();
  });

  // ── flush: transport failure handling ──────────────────────────────────────

  it('re-prepends snapshot in seq order when transport rejects', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('network error'));
    const { sink } = createSink({ transport: { persist }, workerId: HARNESS_SESSION_ROW_ID });
    sink.write({ content: 'a' });
    sink.write({ content: 'b' });

    const warnings: MessageStreamSinkWarning[] = [];
    sink.onWarning((w) => warnings.push(w));

    await sink.flush();

    // Buffer should be restored
    sink.write({ content: 'c' });

    // On next flush (transport ok), all chunks should be in seq order
    const persistOk = vi.fn().mockResolvedValue(undefined);
    (sink as any).options.transport.persist = persistOk;
    await sink.flush();

    const [, chunks] = persistOk.mock.calls[0];
    expect(chunks.map((c: any) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.map((c: any) => c.content)).toEqual(['a', 'b', 'c']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('transport-error');
  });

  it('emits transport-error warning on persist failure', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('down'));
    const { sink } = createSink({ transport: { persist }, workerId: HARNESS_SESSION_ROW_ID });
    const warnings: MessageStreamSinkWarning[] = [];
    sink.onWarning((w) => warnings.push(w));
    sink.write({ content: 'x' });
    await sink.flush();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('transport-error');
    expect(warnings[0].message).toContain('down');
  });

  // ── backpressure ───────────────────────────────────────────────────────────

  it('drops oldest chunk and emits backpressure-drop warning when buffer is full', async () => {
    const { sink, persist } = createSink(); // maxBufferItems: 5
    const warnings: MessageStreamSinkWarning[] = [];
    sink.onWarning((w) => warnings.push(w));

    // Fill to max
    for (let i = 0; i < 5; i++) sink.write({ content: `item-${i}` });

    // This write should drop item-0
    sink.write({ content: 'item-5' });

    await sink.flush();
    const [, chunks] = persist.mock.calls[0];
    expect(chunks).toHaveLength(5);
    expect(chunks[0].content).toBe('item-1'); // item-0 dropped
    expect(chunks[4].content).toBe('item-5');

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('backpressure-drop');
    expect(warnings[0].droppedCount).toBe(1);
  });

  // ── concurrent flush serialization ────────────────────────────────────────

  it('serializes concurrent flush calls (no overlapping persist calls)', async () => {
    let resolveFirst!: () => void;
    const firstPersistDone = new Promise<void>((r) => { resolveFirst = r; });
    const callOrder: string[] = [];

    const persist = vi
      .fn()
      .mockImplementationOnce(async () => {
        callOrder.push('first-start');
        await firstPersistDone;
        callOrder.push('first-end');
      })
      .mockImplementationOnce(async () => {
        callOrder.push('second-start');
        callOrder.push('second-end');
      });

    const { sink } = createSink({ transport: { persist }, workerId: HARNESS_SESSION_ROW_ID });
    sink.write({ content: 'a' });
    const f1 = sink.flush();

    // Yield to allow doFlush_1 to start (past the buffer-snapshot point)
    await Promise.resolve();

    // doFlush_1 is now in-flight (blocked on firstPersistDone); add second item
    sink.write({ content: 'b' });
    const f2 = sink.flush();

    // Unblock first persist so doFlush_1 completes, doFlush_2 runs
    resolveFirst();
    await Promise.all([f1, f2]);

    // second-start must not occur before first-end
    expect(callOrder.indexOf('first-end')).toBeLessThan(callOrder.indexOf('second-start'));
  });

  // ── close ──────────────────────────────────────────────────────────────────

  it('close() flushes remaining buffered chunks', async () => {
    const { sink, persist } = createSink();
    sink.write({ content: 'final' });
    await sink.close();
    expect(persist).toHaveBeenCalledOnce();
    const [, chunks] = persist.mock.calls[0];
    expect(chunks[0].content).toBe('final');
  });

  it('close() is idempotent (second call is a no-op)', async () => {
    const { sink, persist } = createSink();
    sink.write({ content: 'x' });
    await sink.close();
    await sink.close(); // second close
    expect(persist).toHaveBeenCalledOnce(); // only flushed once
  });

  // ── write after close ──────────────────────────────────────────────────────

  it('emits transport-error warning and drops chunks written after close()', async () => {
    const { sink } = createSink();
    const warnings: MessageStreamSinkWarning[] = [];
    sink.onWarning((w) => warnings.push(w));
    await sink.close();
    sink.write({ content: 'too late' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('transport-error');
    expect(warnings[0].message).toContain('closed');
  });

  // ── onWarning: multiple listeners + unsubscribe ────────────────────────────

  it('supports multiple warning listeners and individual unsubscribe', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('fail'));
    const { sink } = createSink({ transport: { persist }, workerId: HARNESS_SESSION_ROW_ID });

    const received1: MessageStreamSinkWarning[] = [];
    const received2: MessageStreamSinkWarning[] = [];
    const unsub1 = sink.onWarning((w) => received1.push(w));
    sink.onWarning((w) => received2.push(w));

    sink.write({ content: 'x' });
    await sink.flush();

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);

    // Unsubscribe listener 1, trigger another warning
    unsub1();
    sink.write({ content: 'y' });
    await sink.flush();

    expect(received1).toHaveLength(1); // unchanged
    expect(received2).toHaveLength(2); // still receiving
  });
});
