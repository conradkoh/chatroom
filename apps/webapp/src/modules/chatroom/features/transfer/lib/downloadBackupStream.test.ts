import { describe, expect, it, vi } from 'vitest';

import { downloadBackupStream } from './downloadBackupStream';

function streamResponse(chunks: Uint8Array[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status });
}

function fetchReturning(response: Response | Promise<Response>) {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

const encoder = new TextEncoder();

describe('downloadBackupStream', () => {
  it('reads the exact byte count, reports progress and returns the blob', async () => {
    const progress: number[] = [];
    const result = await downloadBackupStream({
      url: 'https://storage.example/copy',
      expectedBytes: 6,
      fetchFn: fetchReturning(streamResponse([encoder.encode('abc'), encoder.encode('def')])),
      onProgress: (received) => progress.push(received),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.size).toBe(6);
    expect(progress).toEqual([3, 6]);
  });

  it('fails with size_mismatch when the body is shorter than expected', async () => {
    const result = await downloadBackupStream({
      url: 'https://storage.example/copy',
      expectedBytes: 10,
      fetchFn: fetchReturning(streamResponse([encoder.encode('abcd')])),
    });

    expect(result).toEqual({ ok: false, reason: 'size_mismatch', received: 4 });
  });

  it('fails with http for a non-2xx response', async () => {
    const result = await downloadBackupStream({
      url: 'https://storage.example/copy',
      expectedBytes: 4,
      fetchFn: fetchReturning(new Response('nope', { status: 500 })),
    });

    expect(result).toEqual({ ok: false, reason: 'http', received: 0 });
  });

  it('fails with aborted when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    }) as unknown as typeof fetch;

    const result = await downloadBackupStream({
      url: 'https://storage.example/copy',
      expectedBytes: 4,
      signal: controller.signal,
      fetchFn,
    });

    expect(result).toEqual({ ok: false, reason: 'aborted', received: 0 });
  });

  it('reports a rejected fetch as network', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const result = await downloadBackupStream({
      url: 'https://storage.example/copy',
      expectedBytes: 4,
      fetchFn,
    });

    expect(result).toEqual({ ok: false, reason: 'network', received: 0 });
  });
});
