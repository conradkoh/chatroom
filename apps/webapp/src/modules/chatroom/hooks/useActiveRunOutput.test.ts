/**
 * useActiveRunOutput unit tests
 *
 * Covers:
 * - Running run with gzip tail → hook returns 1 decoded chunk
 * - Terminal run with gzip chunks → hook returns N decoded chunks
 * - Legacy plain-string chunks → returned as-is
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (vi.mock is hoisted — use inline values, no outer refs) ──────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      getRunOutputV2: 'getRunOutputV2',
    },
  },
}));

vi.mock('@workspace/backend/src/output-encoding-browser', () => ({
  decodeOutputBrowser: vi.fn(async (value: any) => {
    if (typeof value === 'string') return value;
    return `decoded:${value.content}`;
  }),
}));

import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useActiveRunOutput } from './useActiveRunOutput';

const mockUseSessionQuery = useSessionQuery as ReturnType<typeof vi.fn>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const encodedHello = {
  compression: 'gzip' as const,
  content: 'H4sIAAAAAAAAE8tIzcnJVyjPL8pJAQCFEUoNCwAAAA==',
};

const encodedWorld = {
  compression: 'gzip' as const,
  content: 'H4sIAAAAAAAAE8tIzcnJVyjPz0nJqQQAj6bk/g8AAAA=',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useActiveRunOutput', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips query when activeRunId is null', () => {
    renderHook(() => useActiveRunOutput(null));
    expect(mockUseSessionQuery).toHaveBeenCalledWith('getRunOutputV2', 'skip');
  });

  it('returns empty chunks while decoding in progress (no flash)', async () => {
    mockUseSessionQuery.mockReturnValue({
      run: { status: 'running', _id: 'run-1' },
      tail: { compression: 'gzip', content: 'H4sIAAAAAAAA...', updatedAt: 1000, totalBytesWritten: 500 },
      chunks: [],
      fullOutputPending: false,
    });

    const { result } = renderHook(() => useActiveRunOutput('run-1'));

    expect(result.current.chunks).toEqual([]);

    await waitFor(() => {
      expect(result.current.chunks).toHaveLength(1);
    });
  });

  describe('running run with tail', () => {
    it('decodes tail and returns it as a single chunk with chunkIndex 0', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-1' },
        tail: { compression: 'gzip', content: 'H4sIAAAAAAAAE8tIzcnJVyjPL8pJAQCFEUoNCwAAAA==', updatedAt: 1000, totalBytesWritten: 500 },
        chunks: [],
        fullOutputPending: false,
      });

      const { result } = renderHook(() => useActiveRunOutput('run-1'));

      await waitFor(() => {
        expect(result.current.chunks).toHaveLength(1);
      });

      expect(result.current.chunks[0]!.chunkIndex).toBe(0);
      expect(result.current.chunks[0]!.timestamp).toBe(1000);
      expect(result.current.chunks[0]!.content).toBeDefined();
      expect(result.current.run).toEqual({ status: 'running', _id: 'run-1' });
    });

    it('re-decodes when tail.updatedAt changes', async () => {
      const tail1 = { compression: 'gzip', content: 'H4sIAAAAAAAAE8tIzcnJVyjPL8pJAQCFEUoNCwAAAA==', updatedAt: 1000, totalBytesWritten: 500 };
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-1' },
        tail: tail1,
        chunks: [],
        fullOutputPending: false,
      });

      const { result, rerender } = renderHook(() => useActiveRunOutput('run-1'));

      await waitFor(() => {
        expect(result.current.chunks).toHaveLength(1);
      });
      expect(result.current.chunks[0]!.timestamp).toBe(1000);

      // Change tail.updatedAt — should trigger re-decode
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-1' },
        tail: { ...tail1, updatedAt: 2000, content: 'H4sIAAAAAAAAE8tIzcnJVyjPz0nJqQQAj6bk/g8AAAA==' },
        chunks: [],
        fullOutputPending: false,
      });

      rerender();

      await waitFor(() => {
        expect(result.current.chunks[0]!.timestamp).toBe(2000);
      });
    });
  });

  describe('terminal run with chunks', () => {
    it('decodes gzip chunks from terminal run', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'completed', _id: 'run-2' },
        tail: null,
        chunks: [
          { content: encodedHello, chunkIndex: 0, timestamp: 1000 },
          { content: encodedWorld, chunkIndex: 1, timestamp: 1001 },
        ],
        fullOutputPending: false,
      });

      const { result } = renderHook(() => useActiveRunOutput('run-2'));

      await waitFor(() => {
        expect(result.current.chunks).toHaveLength(2);
      });

      expect(result.current.chunks[0]!.chunkIndex).toBe(0);
      expect(result.current.chunks[1]!.chunkIndex).toBe(1);
      expect(result.current.chunks[0]!.content).toBeDefined();
      expect(result.current.chunks[1]!.content).toBeDefined();
      expect(result.current.run!.status).toBe('completed');
    });

    it('handles legacy plain-string chunks', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'completed', _id: 'run-3' },
        tail: null,
        chunks: [
          { content: 'legacy plain text', chunkIndex: 0, timestamp: 1000 },
        ],
        fullOutputPending: false,
      });

      const { result } = renderHook(() => useActiveRunOutput('run-3'));

      await waitFor(() => {
        expect(result.current.chunks).toHaveLength(1);
      });

      expect(result.current.chunks[0]!.content).toBe('legacy plain text');
    });
  });
});
