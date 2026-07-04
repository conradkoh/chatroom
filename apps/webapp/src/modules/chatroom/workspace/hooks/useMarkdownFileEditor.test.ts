import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingOptimisticNewFilePaths } from './pendingOptimisticNewFilePaths';
import { useMarkdownFileEditor } from './useMarkdownFileEditor';
import { FILE_READ_ERROR_PLACEHOLDER } from '../utils/fileContentSentinels';

const mockRequestFileContent = vi.fn();
const mockSaveToDisk = vi.fn();

let mockLoadedContent:
  | {
      content: string;
      encoding: string;
      truncated: boolean;
      fetchedAt: number;
    }
  | null
  | undefined = undefined;

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestFileContent,
}));

vi.mock('./useRequestWorkspaceFileContent', () => ({
  useRequestWorkspaceFileContent: () => mockLoadedContent,
}));

vi.mock('./useWorkspaceFileSave', () => ({
  useWorkspaceFileSave: () => ({
    save: mockSaveToDisk,
    saving: false,
    error: null,
    lastSavedAt: null,
  }),
}));

describe('useMarkdownFileEditor optimistic create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingOptimisticNewFilePaths.clear();
    mockLoadedContent = undefined;
    mockSaveToDisk.mockResolvedValue(undefined);
    mockRequestFileContent.mockResolvedValue(undefined);
  });

  it('shows empty editor while a pending new file has no cached content', () => {
    pendingOptimisticNewFilePaths.add('notes.md');
    mockLoadedContent = null;

    const { result } = renderHook(() =>
      useMarkdownFileEditor({
        machineId: 'machine-1',
        workingDir: '/workspace',
        filePath: 'notes.md',
        initialEmpty: true,
      })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.content).toBe('');
  });

  it('ignores transient read-error content while create is still pending', async () => {
    pendingOptimisticNewFilePaths.add('notes.md');
    mockLoadedContent = {
      content: FILE_READ_ERROR_PLACEHOLDER,
      encoding: 'utf8',
      truncated: false,
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() =>
      useMarkdownFileEditor({
        machineId: 'machine-1',
        workingDir: '/workspace',
        filePath: 'notes.md',
        initialEmpty: true,
      })
    );

    await waitFor(() => {
      expect(result.current.content).toBe('');
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('applies real content after create confirms and cache refreshes', async () => {
    pendingOptimisticNewFilePaths.add('notes.md');

    const { result, rerender } = renderHook(() =>
      useMarkdownFileEditor({
        machineId: 'machine-1',
        workingDir: '/workspace',
        filePath: 'notes.md',
        initialEmpty: true,
      })
    );

    mockLoadedContent = {
      content: FILE_READ_ERROR_PLACEHOLDER,
      encoding: 'utf8',
      truncated: false,
      fetchedAt: Date.now(),
    };
    rerender();

    await waitFor(() => {
      expect(result.current.content).toBe('');
    });

    await act(async () => {
      pendingOptimisticNewFilePaths.delete('notes.md');
    });

    mockLoadedContent = {
      content: '# Hello',
      encoding: 'utf8',
      truncated: false,
      fetchedAt: Date.now(),
    };
    rerender();

    await waitFor(() => {
      expect(result.current.content).toBe('# Hello');
    });
  });
});
