import { describe, it, expect, vi } from 'vitest';
import { ConvexMessageStreamTransport } from './convex-transport.js';
import type { ConvexMessageStreamTransportBackend } from './convex-transport.js';
import type { HarnessSessionRowId } from '../../../../domain/direct-harness/harness-session.js';
import type { MessageStreamChunk } from '../../../../domain/direct-harness/message-stream/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-session-id';
const WORKER_ID = 'worker-abc' as HarnessSessionRowId;

function createBackend(): { backend: ConvexMessageStreamTransportBackend; mutation: ReturnType<typeof vi.fn> } {
  const mutation = vi.fn().mockResolvedValue(undefined);
  return { backend: { mutation }, mutation };
}

function makeChunk(seq: number, content: string, timestamp = 1000): MessageStreamChunk {
  return { seq, content, timestamp };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ConvexMessageStreamTransport', () => {
  it('does not call the backend when the chunk array is empty', async () => {
    const { backend, mutation } = createBackend();
    const transport = new ConvexMessageStreamTransport({ backend, sessionId: SESSION_ID });

    await transport.persist(WORKER_ID, []);

    expect(mutation).not.toHaveBeenCalled();
  });

  it('calls client.mutation with sessionId, workerId, and the chunks array', async () => {
    const { backend, mutation } = createBackend();
    const transport = new ConvexMessageStreamTransport({ backend, sessionId: SESSION_ID });
    const chunks = [makeChunk(0, 'hello', 42)];

    await transport.persist(WORKER_ID, chunks);

    expect(mutation).toHaveBeenCalledOnce();
    const [, args] = mutation.mock.calls[0];
    expect(args.sessionId).toBe(SESSION_ID);
    expect(args.harnessSessionRowId).toBe(WORKER_ID);
    expect(args.chunks).toEqual([{ seq: 0, content: 'hello', timestamp: 42 }]);
  });

  it('forwards only seq, content, timestamp — no extra fields from MessageStreamChunk', async () => {
    const { backend, mutation } = createBackend();
    const transport = new ConvexMessageStreamTransport({ backend, sessionId: SESSION_ID });
    // Create a chunk with extra properties (to verify the mapping strips them)
    const richChunk = { seq: 1, content: 'data', timestamp: 999 } satisfies MessageStreamChunk;
    await transport.persist(WORKER_ID, [richChunk]);

    const [, args] = mutation.mock.calls[0];
    const sentChunk = args.chunks[0];
    expect(Object.keys(sentChunk)).toEqual(['seq', 'content', 'timestamp']);
    expect(sentChunk).toEqual({ seq: 1, content: 'data', timestamp: 999 });
  });

  it('forwards multiple chunks in the same order as the input array', async () => {
    const { backend, mutation } = createBackend();
    const transport = new ConvexMessageStreamTransport({ backend, sessionId: SESSION_ID });
    const chunks = [makeChunk(0, 'a'), makeChunk(1, 'b'), makeChunk(2, 'c')];

    await transport.persist(WORKER_ID, chunks);

    const [, args] = mutation.mock.calls[0];
    expect(args.chunks.map((c: { seq: number }) => c.seq)).toEqual([0, 1, 2]);
    expect(args.chunks.map((c: { content: string }) => c.content)).toEqual(['a', 'b', 'c']);
  });

  it('propagates rejection from the backend mutation as a rejected promise', async () => {
    const { backend } = createBackend();
    vi.mocked(backend.mutation).mockRejectedValue(new Error('Convex disconnect'));
    const transport = new ConvexMessageStreamTransport({ backend, sessionId: SESSION_ID });

    await expect(transport.persist(WORKER_ID, [makeChunk(0, 'x')])).rejects.toThrow('Convex disconnect');
  });
});
