import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useSketchClipboardPaste } from './useSketchClipboardPaste';
import { getImageFilesFromClipboard } from '../../hooks/clipboardImageFiles';

vi.mock('../../hooks/clipboardImageFiles', () => ({ getImageFilesFromClipboard: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const IMAGE = new File(['x'], 'x.png', { type: 'image/png' });

/**
 * jsdom lacks a usable `ClipboardEvent`/`DataTransfer`, so build a plain bubbling,
 * cancelable `paste` event and attach `clipboardData` manually.
 */
function createPasteEvent(files: File[]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  });
  return event;
}

describe('useSketchClipboardPaste', () => {
  beforeEach(() => vi.clearAllMocks());

  it('imports the first image pasted on document and prevents default', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    const importPastedImage = vi.fn().mockResolvedValue(true);
    const onTransformRequested = vi.fn();
    renderHook(() =>
      useSketchClipboardPaste({ disabled: false, importPastedImage, onTransformRequested })
    );
    const event = createPasteEvent([IMAGE]);
    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(event.defaultPrevented).toBe(true);
    expect(importPastedImage).toHaveBeenCalledWith(IMAGE);
    expect(onTransformRequested).toHaveBeenCalledTimes(1);
  });

  it('ignores paste targeted at an editable input', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    const importPastedImage = vi.fn().mockResolvedValue(true);
    renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage,
        onTransformRequested: vi.fn(),
      })
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = createPasteEvent([IMAGE]);
    await act(async () => {
      input.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(event.defaultPrevented).toBe(false);
    expect(importPastedImage).not.toHaveBeenCalled();
    input.remove();
  });

  it('ignores a second paste while the first is still importing', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    let resolveImport: (value: boolean) => void = () => undefined;
    const importPastedImage = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveImport = resolve;
        })
    );
    renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage,
        onTransformRequested: vi.fn(),
      })
    );
    const first = createPasteEvent([IMAGE]);
    act(() => {
      document.dispatchEvent(first);
    });
    const second = createPasteEvent([IMAGE]);
    await act(async () => {
      document.dispatchEvent(second);
      await Promise.resolve();
    });
    expect(importPastedImage).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    await act(async () => {
      resolveImport(true);
      await Promise.resolve();
    });
  });

  it('removes the document listener on unmount', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    const importPastedImage = vi.fn().mockResolvedValue(true);
    const { unmount } = renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage,
        onTransformRequested: vi.fn(),
      })
    );
    unmount();
    const event = createPasteEvent([IMAGE]);
    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(importPastedImage).not.toHaveBeenCalled();
  });

  it('ignores paste when disabled', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    const importPastedImage = vi.fn();
    renderHook(() =>
      useSketchClipboardPaste({
        disabled: true,
        importPastedImage,
        onTransformRequested: vi.fn(),
      })
    );
    await act(async () => {
      document.dispatchEvent(createPasteEvent([IMAGE]));
      await Promise.resolve();
    });
    expect(importPastedImage).not.toHaveBeenCalled();
  });

  it('ignores non-image clipboard', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([]);
    const importPastedImage = vi.fn();
    renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage,
        onTransformRequested: vi.fn(),
      })
    );
    const event = createPasteEvent([]);
    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(event.defaultPrevented).toBe(false);
    expect(importPastedImage).not.toHaveBeenCalled();
  });

  it('toasts when the import fails', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([IMAGE]);
    renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage: vi.fn().mockResolvedValue(false),
        onTransformRequested: vi.fn(),
      })
    );
    await act(async () => {
      document.dispatchEvent(createPasteEvent([IMAGE]));
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalled();
  });
});
