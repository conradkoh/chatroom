import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceUploadJobs } from './useWorkspaceUploadJobs';
import {
  COMPLETE_PROGRESS,
  FINALIZING_PROGRESS,
  UPLOAD_COMPLETE_DISMISS_MS,
  UPLOAD_ERROR_DISMISS_MS,
} from '../utils/workspaceUploadProgress';

const mockUploadFile = vi.hoisted(() => vi.fn());

vi.mock('./useWorkspaceFileUpload', () => ({
  useWorkspaceFileUpload: () => ({ uploadFile: mockUploadFile }),
}));

function makeFile(name = 'notes.md'): File {
  return new File(['hello'], name, { type: 'text/markdown' });
}

describe('useWorkspaceUploadJobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUploadFile.mockReset();
    mockUploadFile.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks uploading → finalizing → complete → dismissed', async () => {
    const onUploadComplete = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceUploadJobs({
        machineId: 'm',
        workingDir: '/w',
        onUploadComplete,
      })
    );

    await act(async () => {
      await result.current.startUpload('docs/notes.md', makeFile());
    });

    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    const [filePath, file] = mockUploadFile.mock.calls[0] as [string, File];
    expect(filePath).toBe('docs/notes.md');
    expect(file.name).toBe('notes.md');

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({
      filePath: 'docs/notes.md',
      fileName: 'notes.md',
      phase: 'complete',
      percent: COMPLETE_PROGRESS,
    });
    expect(onUploadComplete).toHaveBeenCalledWith('docs/notes.md');

    act(() => {
      vi.advanceTimersByTime(UPLOAD_COMPLETE_DISMISS_MS);
    });
    expect(result.current.jobs).toHaveLength(0);
  });

  it('emits progress updates from the upload callback', async () => {
    let onProgress: ((update: { phase: string; percent: number }) => void) | undefined;
    mockUploadFile.mockImplementation(
      async (
        _path: string,
        _file: File,
        progress: (update: { phase: string; percent: number }) => void
      ) => {
        onProgress = progress;
      }
    );

    const { result } = renderHook(() =>
      useWorkspaceUploadJobs({ machineId: 'm', workingDir: '/w' })
    );

    let started: Promise<void> | undefined;
    act(() => {
      started = result.current.startUpload('a.txt', makeFile('a.txt'));
    });

    expect(result.current.jobs[0]).toMatchObject({ phase: 'uploading', percent: 0 });

    act(() => {
      onProgress?.({ phase: 'uploading', percent: 40 });
    });
    expect(result.current.jobs[0]).toMatchObject({ phase: 'uploading', percent: 40 });

    act(() => {
      onProgress?.({ phase: 'finalizing', percent: FINALIZING_PROGRESS });
    });
    expect(result.current.jobs[0]).toMatchObject({
      phase: 'finalizing',
      percent: FINALIZING_PROGRESS,
    });

    await act(async () => {
      await started;
    });
    expect(result.current.jobs[0]).toMatchObject({ phase: 'complete', percent: COMPLETE_PROGRESS });
  });

  it('marks job as error, calls onUploadFailed, and dismisses after error delay', async () => {
    mockUploadFile.mockRejectedValue(new Error('Disk full'));
    const onUploadFailed = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceUploadJobs({
        machineId: 'm',
        workingDir: '/w',
        onUploadFailed,
      })
    );

    await act(async () => {
      await result.current.startUpload('docs/notes.md', makeFile());
    });

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]).toMatchObject({
      filePath: 'docs/notes.md',
      phase: 'error',
      errorMessage: 'Disk full',
    });
    expect(onUploadFailed).toHaveBeenCalledWith('docs/notes.md', 'Disk full');

    act(() => {
      vi.advanceTimersByTime(UPLOAD_ERROR_DISMISS_MS);
    });
    expect(result.current.jobs).toHaveLength(0);
  });

  it('supports multiple concurrent jobs with per-job state', async () => {
    const resolvers: (() => void)[] = [];
    mockUploadFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const { result } = renderHook(() =>
      useWorkspaceUploadJobs({ machineId: 'm', workingDir: '/w' })
    );

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.startUpload('a.txt', makeFile('a.txt'));
      second = result.current.startUpload('b.txt', makeFile('b.txt'));
    });

    expect(result.current.jobs).toHaveLength(2);
    expect(result.current.jobs.map((job) => job.filePath).sort()).toEqual(['a.txt', 'b.txt']);

    await act(async () => {
      resolvers[0]?.();
      await first;
    });

    expect(result.current.jobs.find((job) => job.filePath === 'a.txt')).toMatchObject({
      phase: 'complete',
    });
    expect(result.current.jobs.find((job) => job.filePath === 'b.txt')).toMatchObject({
      phase: 'uploading',
    });

    await act(async () => {
      resolvers[1]?.();
      await second;
    });
    expect(result.current.jobs.find((job) => job.filePath === 'b.txt')).toMatchObject({
      phase: 'complete',
    });
  });

  it('cleans up dismiss timers on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useWorkspaceUploadJobs({ machineId: 'm', workingDir: '/w' })
    );

    await act(async () => {
      await result.current.startUpload('a.txt', makeFile('a.txt'));
    });
    expect(result.current.jobs).toHaveLength(1);

    expect(() => unmount()).not.toThrow();
  });
});
