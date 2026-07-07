import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileContent } from './useFileContent';
import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

vi.mock('../utils/decompressGzip', () => ({
  extractBase64Content: vi.fn((d: { content: string }) => d.content),
  decompressGzip: vi.fn(),
}));

const QUERY_ARGS = { machineId: 'm1', workingDir: '/wd', filePath: 'foo.ts' };

beforeEach(() => {
  vi.mocked(extractBase64Content).mockImplementation((d) =>
    typeof d === 'string' ? d : d.content
  );
  vi.mocked(decompressGzip).mockImplementation(async (b64: string) => `decompressed:${b64}`);
  mockUseSessionQuery.mockReset();
});

describe('useFileContent', () => {
  it('returns undefined while query is loading', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useFileContent(QUERY_ARGS));
    expect(result.current).toBeUndefined();
  });

  it('decompresses gzip file content', async () => {
    mockUseSessionQuery.mockReturnValue({
      data: { compression: 'gzip', content: 'abc' },
      encoding: 'utf8',
      truncated: false,
      fetchedAt: 123,
    });

    const { result } = renderHook(() => useFileContent(QUERY_ARGS));

    await waitFor(() => {
      expect(result.current).toEqual({
        content: 'decompressed:abc',
        encoding: 'utf8',
        truncated: false,
        fetchedAt: 123,
      });
    });
  });

  it('does not restart decompression when Convex returns a new row object with same payload', async () => {
    const rowA = {
      data: { compression: 'gzip' as const, content: 'abc' },
      encoding: 'utf8',
      truncated: false,
      fetchedAt: 123,
    };
    const rowB = {
      data: { compression: 'gzip' as const, content: 'abc' },
      encoding: 'utf8',
      truncated: false,
      fetchedAt: 123,
    };

    mockUseSessionQuery.mockReturnValue(rowA);
    const { result, rerender } = renderHook(() => useFileContent(QUERY_ARGS));

    await waitFor(() => {
      expect(result.current?.content).toBe('decompressed:abc');
    });

    const callsBeforeRerender = vi.mocked(decompressGzip).mock.calls.length;

    mockUseSessionQuery.mockReturnValue(rowB);
    rerender();

    await waitFor(() => {
      expect(result.current?.content).toBe('decompressed:abc');
    });

    expect(decompressGzip).toHaveBeenCalledTimes(callsBeforeRerender);
  });
});
