import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardFile } from './git-writer.js';

const mockRunGit = vi.fn();

vi.mock('./run-command.js', () => ({
  runGit: (...args: unknown[]) => mockRunGit(...args),
}));

describe('discardFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes filePath as argv element via runGit', async () => {
    mockRunGit.mockResolvedValue({ stdout: '', stderr: '' });
    const filePath = 'src/evil;rm -rf /';

    await discardFile('/repo', filePath);

    expect(mockRunGit).toHaveBeenCalledWith(['checkout', '--', filePath], '/repo');
  });
});
