import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDecompressedQueryJson } from './useDecompressedQueryJson';
import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

vi.mock('../utils/decompressGzip', () => ({
  extractBase64Content: vi.fn((d: { content: string }) => d.content),
  decompressGzip: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(extractBase64Content).mockImplementation((d) =>
    typeof d === 'string' ? d : d.content
  );
  vi.mocked(decompressGzip).mockImplementation(async (b64: string) => `decompressed:${b64}`);
});

describe('useDecompressedQueryJson', () => {
  it('returns undefined when disabled', () => {
    const { result } = renderHook(() =>
      useDecompressedQueryJson({ data: { compression: 'gzip', content: 'abc' } }, false)
    );
    expect(result.current).toBeUndefined();
  });

  it('returns undefined while query is loading', () => {
    const { result } = renderHook(() => useDecompressedQueryJson(undefined, true));
    expect(result.current).toBeUndefined();
  });

  it('returns null when query row is missing', () => {
    const { result } = renderHook(() => useDecompressedQueryJson(null, true));
    expect(result.current).toBeNull();
  });

  it('decompresses gzip row data', async () => {
    const { result } = renderHook(() =>
      useDecompressedQueryJson({ data: { compression: 'gzip', content: 'abc' } }, true)
    );

    await waitFor(() => {
      expect(result.current).toBe('decompressed:abc');
    });
    expect(extractBase64Content).toHaveBeenCalledWith({
      compression: 'gzip',
      content: 'abc',
    });
    expect(decompressGzip).toHaveBeenCalledWith('abc');
  });

  it('returns null when decompression fails', async () => {
    vi.mocked(decompressGzip).mockImplementation(() => Promise.reject(new Error('bad gzip')));

    const { result } = renderHook(() =>
      useDecompressedQueryJson({ data: { compression: 'gzip', content: 'bad' } }, true)
    );

    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it('does not restart decompression when Convex returns a new row object with same payload', async () => {
    const rowA = { data: { compression: 'gzip' as const, content: 'abc' } };
    const rowB = { data: { compression: 'gzip' as const, content: 'abc' } };

    const { result, rerender } = renderHook(({ row }) => useDecompressedQueryJson(row, true), {
      initialProps: { row: rowA },
    });

    await waitFor(() => {
      expect(result.current).toBe('decompressed:abc');
    });

    const callsBeforeRerender = vi.mocked(decompressGzip).mock.calls.length;

    rerender({ row: rowB });

    await waitFor(() => {
      expect(result.current).toBe('decompressed:abc');
    });

    expect(decompressGzip).toHaveBeenCalledTimes(callsBeforeRerender);
  });
});
