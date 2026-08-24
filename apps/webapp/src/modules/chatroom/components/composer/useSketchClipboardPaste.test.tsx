import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useSketchClipboardPaste } from './useSketchClipboardPaste';
import { getImageFilesFromClipboard } from '../../hooks/clipboardImageFiles';

vi.mock('../../hooks/clipboardImageFiles', () => ({ getImageFilesFromClipboard: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
describe('useSketchClipboardPaste', () => {
  beforeEach(() => vi.clearAllMocks());
  it('imports the first image and prevents default', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([file]);
    const importPastedImage = vi.fn().mockResolvedValue(true);
    const transform = vi.fn();
    const { result } = renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage,
        onTransformRequested: transform,
      })
    );
    const event = {
      clipboardData: {} as DataTransfer,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
    } as any;
    await act(async () => result.current.onPaste(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(importPastedImage).toHaveBeenCalledWith(file);
    expect(transform).toHaveBeenCalled();
  });
  it('ignores non-image clipboard', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([]);
    const event = {
      clipboardData: null,
      target: document.createElement('div'),
      preventDefault: vi.fn(),
    } as any;
    const { result } = renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage: vi.fn(),
        onTransformRequested: vi.fn(),
      })
    );
    await act(async () => result.current.onPaste(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('toasts when import fails', async () => {
    vi.mocked(getImageFilesFromClipboard).mockReturnValue([
      new File(['x'], 'x.png', { type: 'image/png' }),
    ]);
    const { result } = renderHook(() =>
      useSketchClipboardPaste({
        disabled: false,
        importPastedImage: vi.fn().mockResolvedValue(false),
        onTransformRequested: vi.fn(),
      })
    );
    await act(async () =>
      result.current.onPaste({
        clipboardData: {},
        target: document.createElement('div'),
        preventDefault: vi.fn(),
      } as never)
    );
    expect(toast.error).toHaveBeenCalled();
  });
});
