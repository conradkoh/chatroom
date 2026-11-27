/**
 * Backup directory resolution tests.
 *
 * Pure: `env`, `cwd` and `exists` are injected, so the walk-up rules are observable without
 * touching the real filesystem.
 */

import { describe, expect, it } from 'vitest';

import { resolveUserBackupsDir } from './user-backups-dir.js';

const EXPECTED = '/repo/services/backend/.convex/user-backups';

function existsIn(paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe('resolveUserBackupsDir', () => {
  it('uses CHATROOM_REPO_ROOT when the stack is present', () => {
    expect(
      resolveUserBackupsDir({
        env: { CHATROOM_REPO_ROOT: '/repo' },
        cwd: '/somewhere/else',
        exists: existsIn(['/repo/services/backend']),
      })
    ).toBe(EXPECTED);
  });

  it('returns null when CHATROOM_REPO_ROOT has no local stack', () => {
    expect(
      resolveUserBackupsDir({
        env: { CHATROOM_REPO_ROOT: '/repo' },
        cwd: '/somewhere/else',
        exists: existsIn([]),
      })
    ).toBeNull();
  });

  it('walks up from cwd to the workspace root when no env root is set', () => {
    expect(
      resolveUserBackupsDir({
        env: {},
        cwd: '/repo/packages/cli',
        exists: existsIn(['/repo/pnpm-workspace.yaml', '/repo/services/backend']),
      })
    ).toBe(EXPECTED);
  });

  it('returns null when no workspace root is found', () => {
    expect(
      resolveUserBackupsDir({
        env: {},
        cwd: '/repo/packages/cli',
        exists: existsIn([]),
      })
    ).toBeNull();
  });
});
