import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileDownloadActions } from './useFileDownloadActions';
import {
  exportFileAsDocx,
  exportFileAsPdf,
  saveTextFile,
  type SaveFileResult,
} from '../../lib/messageExport';

vi.mock('../../lib/messageExport', async () => {
  const formats = (await vi.importActual('../../lib/messageExport/downloadFormats')) as Record<
    string,
    unknown
  >;
  return {
    ...formats,
    saveTextFile: vi.fn().mockResolvedValue('saved'),
    exportFileAsDocx: vi.fn().mockResolvedValue('saved'),
    exportFileAsPdf: vi.fn().mockResolvedValue('saved'),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const callbacks = () => ({
  onStart: vi.fn(),
  onError: vi.fn(),
  onRequestClose: vi.fn(),
});

function renderActions(overrides: Partial<Parameters<typeof useFileDownloadActions>[0]> = {}) {
  return renderHook(() =>
    useFileDownloadActions({
      filePath: 'docs/README.md',
      workingDir: null,
      content: 'body',
      enabled: true,
      ...overrides,
    })
  );
}

describe('useFileDownloadActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveTextFile).mockResolvedValue('saved');
    vi.mocked(exportFileAsDocx).mockResolvedValue('saved');
    vi.mocked(exportFileAsPdf).mockResolvedValue('saved');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves markdown bytes under the source base name and closes', async () => {
    const spies = callbacks();
    const { result } = renderActions(spies);

    await act(async () => {
      result.current.run('md');
    });

    expect(saveTextFile).toHaveBeenCalledWith('README.md', 'body', 'text/markdown', [
      '.md',
      '.markdown',
      '.mdx',
    ]);
    expect(result.current.busyFormat).toBeNull();
    expect(spies.onStart).toHaveBeenCalledTimes(1);
    expect(spies.onRequestClose).toHaveBeenCalledTimes(1);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it('shows a DOCX busy row and ignores a second run while busy', async () => {
    const spies = callbacks();
    const pending = deferred<SaveFileResult>();
    vi.mocked(exportFileAsDocx).mockReturnValueOnce(pending.promise);
    const { result } = renderActions(spies);

    await act(async () => {
      result.current.run('docx');
    });

    expect(result.current.busyFormat).toBe('docx');
    expect(exportFileAsDocx).toHaveBeenCalledWith('docs/README.md', 'body');

    await act(async () => {
      result.current.run('pdf');
    });
    expect(exportFileAsPdf).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve('saved');
      await pending.promise;
    });

    expect(result.current.busyFormat).toBeNull();
    expect(spies.onRequestClose).toHaveBeenCalledTimes(1);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it('shows a PDF busy row and closes when the export resolves', async () => {
    const spies = callbacks();
    const pending = deferred<SaveFileResult>();
    vi.mocked(exportFileAsPdf).mockReturnValueOnce(pending.promise);
    const { result } = renderActions(spies);

    await act(async () => {
      result.current.run('pdf');
    });

    expect(result.current.busyFormat).toBe('pdf');
    expect(exportFileAsPdf).toHaveBeenCalledWith('docs/README.md', 'body');

    await act(async () => {
      pending.resolve('saved');
      await pending.promise;
    });

    expect(result.current.busyFormat).toBeNull();
    expect(spies.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the download is not enabled', async () => {
    const spies = callbacks();
    const { result } = renderActions({ ...spies, enabled: false });

    await act(async () => {
      result.current.run('docx');
    });

    expect(exportFileAsDocx).not.toHaveBeenCalled();
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(spies.onStart).not.toHaveBeenCalled();
    expect(spies.onRequestClose).not.toHaveBeenCalled();
  });

  it('reports the DOCX failure copy and closes the menu', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spies = callbacks();
    vi.mocked(exportFileAsDocx).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderActions(spies);

    await act(async () => {
      result.current.run('docx');
      await Promise.resolve();
    });

    expect(spies.onError).toHaveBeenCalledWith('Failed to prepare DOCX');
    expect(consoleError).toHaveBeenCalledWith(
      '[WorkspaceFileMenu] DOCX export failed',
      expect.any(Error)
    );
    expect(spies.onRequestClose).toHaveBeenCalledTimes(1);
    expect(result.current.busyFormat).toBeNull();
  });

  it('releases the in-flight key when a host onStart throws, so the next run proceeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = callbacks();
    failing.onStart.mockImplementationOnce(() => {
      throw new Error('host feedback failed');
    });
    const first = renderActions(failing);

    await act(async () => {
      first.result.current.run('docx');
      await Promise.resolve();
    });

    expect(exportFileAsDocx).not.toHaveBeenCalled();
    expect(failing.onError).toHaveBeenCalledWith('Failed to prepare DOCX');
    expect(failing.onRequestClose).toHaveBeenCalledTimes(1);
    expect(first.result.current.busyFormat).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '[WorkspaceFileMenu] DOCX export failed',
      expect.any(Error)
    );
    first.unmount();

    const retry = callbacks();
    const second = renderActions(retry);
    await act(async () => {
      second.result.current.run('docx');
    });

    expect(retry.onStart).toHaveBeenCalledTimes(1);
    expect(exportFileAsDocx).toHaveBeenCalledWith('docs/README.md', 'body');
    expect(second.result.current.busyFormat).toBeNull();
    expect(retry.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('treats a cancelled save as silent success', async () => {
    const spies = callbacks();
    vi.mocked(exportFileAsPdf).mockResolvedValueOnce('cancelled');
    const { result } = renderActions(spies);

    await act(async () => {
      result.current.run('pdf');
    });

    expect(spies.onError).not.toHaveBeenCalled();
    expect(spies.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the busy row and the double-run guard across an unmount and remount for the same file', async () => {
    const pending = deferred<SaveFileResult>();
    vi.mocked(exportFileAsDocx).mockReturnValueOnce(pending.promise);
    const first = renderActions();

    await act(async () => {
      first.result.current.run('docx');
    });
    first.unmount();

    const second = renderActions();
    expect(second.result.current.busyFormat).toBe('docx');

    await act(async () => {
      second.result.current.run('pdf');
    });
    expect(exportFileAsPdf).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve('saved');
      await pending.promise;
    });
    expect(second.result.current.busyFormat).toBeNull();
  });

  it('does not block the same relative path in a different workspace', async () => {
    const pending = deferred<SaveFileResult>();
    vi.mocked(exportFileAsDocx).mockReturnValueOnce(pending.promise);
    const first = renderActions({ workingDir: '/workspace/a' });
    const other = renderActions({ workingDir: '/workspace/b' });

    await act(async () => {
      first.result.current.run('docx');
    });
    await act(async () => {
      other.result.current.run('pdf');
    });
    expect(exportFileAsPdf).toHaveBeenCalledWith('docs/README.md', 'body');

    await act(async () => {
      pending.resolve('saved');
      await pending.promise;
    });
  });
});
