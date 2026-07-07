import { execFileSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { pickFolderDialog } from './pick-folder.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('pickFolderDialog', () => {
  it('returns selected path on macOS', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    vi.mocked(execFileSync).mockReturnValue('/Users/dev/project\n');

    const result = pickFolderDialog();
    expect(result).toEqual({ success: true, path: '/Users/dev/project' });
  });

  it('returns cancelled when dialog is dismissed', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const error = Object.assign(new Error('cancelled'), { status: 1 });
    vi.mocked(execFileSync).mockImplementation(() => {
      throw error;
    });

    const result = pickFolderDialog();
    expect(result).toEqual({ success: false, error: 'Cancelled', cancelled: true });
  });

  it('returns error when dialog returns empty path', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    vi.mocked(execFileSync).mockReturnValue('\n');

    const result = pickFolderDialog();
    expect(result).toEqual({ success: false, error: 'No folder selected' });
  });
});
