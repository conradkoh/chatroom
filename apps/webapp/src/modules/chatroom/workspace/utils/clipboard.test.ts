import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
  copyFullPathToClipboard,
  copyRelativePathToClipboard,
  copyWorkspacePathToClipboard,
} from './clipboard';

const FAILURE = { ok: false, message: 'Failed to copy to clipboard' };

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

  it('copyRelativePathToClipboard writes the path and returns ok', async () => {
    await expect(copyRelativePathToClipboard('src/foo.ts')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('src/foo.ts');
  });

  it('copyFullPathToClipboard joins workingDir and relative path and returns ok', async () => {
    await expect(copyFullPathToClipboard('/workspace/proj', 'src/foo.ts')).resolves.toEqual({
      ok: true,
    });
    expect(writeText).toHaveBeenCalledWith('/workspace/proj/src/foo.ts');
  });

  it('copyFullPathToClipboard returns the failure shape and writes nothing when workingDir is null', async () => {
    await expect(copyFullPathToClipboard(null, 'src/foo.ts')).resolves.toEqual(FAILURE);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copyFileNameToClipboard copies the basename only', async () => {
    await expect(copyFileNameToClipboard('src/nested/foo.ts')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('foo.ts');
  });

  it('copyWorkspacePathToClipboard writes the workspace path', async () => {
    await expect(copyWorkspacePathToClipboard('/workspace/proj')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('/workspace/proj');
  });

  it('copyFileContentToClipboard writes the content', async () => {
    await expect(copyFileContentToClipboard('hello')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it.each([
    ['copyRelativePathToClipboard', () => copyRelativePathToClipboard('src/foo.ts')],
    ['copyFileNameToClipboard', () => copyFileNameToClipboard('src/foo.ts')],
    ['copyFullPathToClipboard', () => copyFullPathToClipboard('/workspace/proj', 'src/foo.ts')],
    ['copyWorkspacePathToClipboard', () => copyWorkspacePathToClipboard('/workspace/proj')],
    ['copyFileContentToClipboard', () => copyFileContentToClipboard('hello')],
  ])('%s returns the failure shape when writeText rejects', async (_name, copy) => {
    writeText.mockRejectedValue(new Error('denied'));
    await expect(copy()).resolves.toEqual(FAILURE);
  });
});
