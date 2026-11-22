import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExplorerFileDrop } from './useExplorerFileDrop';

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'text/plain' });
}

function makeDropEvent(files: File[]): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: ['Files'],
      files,
      dropEffect: 'copy',
    },
    clientX: 0,
    clientY: 0,
  } as unknown as React.DragEvent;
}

describe('useExplorerFileDrop', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(null),
    });
  });

  it('advances A→B→C without skipping on dialog close', () => {
    const { result } = renderHook(() => useExplorerFileDrop({ onBlocked: vi.fn() }));

    act(() => {
      result.current.handleDrop(
        makeDropEvent([makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')])
      );
    });

    expect(result.current.pendingUpload?.file.name).toBe('a.txt');
    expect(result.current.remainingCount).toBe(2);

    act(() => {
      result.current.handleUploadDialogOpenChange(false);
    });
    expect(result.current.pendingUpload?.file.name).toBe('b.txt');
    expect(result.current.remainingCount).toBe(1);

    act(() => {
      result.current.handleUploadDialogOpenChange(false);
    });
    expect(result.current.pendingUpload?.file.name).toBe('c.txt');
    expect(result.current.remainingCount).toBe(0);

    act(() => {
      result.current.handleUploadDialogOpenChange(false);
    });
    expect(result.current.pendingUpload).toBeNull();
    expect(result.current.uploadDialogOpen).toBe(false);
  });

  it('cancel skips the current file and advances to the next', () => {
    const { result } = renderHook(() => useExplorerFileDrop({ onBlocked: vi.fn() }));

    act(() => {
      result.current.handleDrop(makeDropEvent([makeFile('skip.txt'), makeFile('keep.txt')]));
    });

    expect(result.current.pendingUpload?.file.name).toBe('skip.txt');

    act(() => {
      result.current.handleUploadDialogOpenChange(false);
    });

    expect(result.current.pendingUpload?.file.name).toBe('keep.txt');
  });

  it('reports a blocked drop through onBlocked and opens no upload', () => {
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useExplorerFileDrop({ onBlocked }));

    act(() => {
      result.current.handleDrop(makeDropEvent([makeFile('.env')]));
    });

    expect(onBlocked).toHaveBeenCalledWith(
      'Cannot upload to this location (.git and sensitive paths are blocked)'
    );
    expect(result.current.pendingUpload).toBeNull();
  });

  it('does not call onBlocked for an allowed drop', () => {
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useExplorerFileDrop({ onBlocked }));

    act(() => {
      result.current.handleDrop(makeDropEvent([makeFile('notes.txt')]));
    });

    expect(onBlocked).not.toHaveBeenCalled();
    expect(result.current.pendingUpload?.file.name).toBe('notes.txt');
  });
});
