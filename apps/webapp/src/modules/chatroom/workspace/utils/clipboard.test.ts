import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
  copyFullPathToClipboard,
  copyRelativePathToClipboard,
} from './clipboard';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('clipboard utils', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('copyRelativePathToClipboard copies path and toasts', async () => {
    await copyRelativePathToClipboard('src/foo.ts');
    expect(writeText).toHaveBeenCalledWith('src/foo.ts');
    expect(toast.success).toHaveBeenCalledWith('Copied relative path');
  });

  it('copyFullPathToClipboard joins workingDir and relative path', async () => {
    await copyFullPathToClipboard('/workspace/proj', 'src/foo.ts');
    expect(writeText).toHaveBeenCalledWith('/workspace/proj/src/foo.ts');
    expect(toast.success).toHaveBeenCalledWith('Copied full path');
  });

  it('copyFullPathToClipboard no-ops when workingDir is null', async () => {
    await copyFullPathToClipboard(null, 'src/foo.ts');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copyFileNameToClipboard copies basename only', async () => {
    await copyFileNameToClipboard('src/nested/foo.ts');
    expect(writeText).toHaveBeenCalledWith('foo.ts');
    expect(toast.success).toHaveBeenCalledWith('Copied file name');
  });

  it('copyFileContentToClipboard toasts truncated variant', async () => {
    await copyFileContentToClipboard('hello', { truncated: true });
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(toast.success).toHaveBeenCalledWith('Copied file content (truncated)');
  });

  it('copyFileContentToClipboard toasts normal variant', async () => {
    await copyFileContentToClipboard('hello');
    expect(toast.success).toHaveBeenCalledWith('Copied file content');
  });
});
