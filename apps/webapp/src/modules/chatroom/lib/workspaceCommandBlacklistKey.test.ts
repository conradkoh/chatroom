import { describe, expect, it } from 'vitest';

import {
  workspaceCommandBlacklistKey,
  parseWorkspaceCommandBlacklistKeyFromId,
} from './workspaceCommandBlacklistKey';

describe('workspaceCommandBlacklistKey', () => {
  it('returns ws-{action}', () => {
    expect(workspaceCommandBlacklistKey('git-pull')).toBe('ws-git-pull');
  });
});

describe('parseWorkspaceCommandBlacklistKeyFromId', () => {
  it('parses legacy workspace id with short id segment', () => {
    expect(parseWorkspaceCommandBlacklistKeyFromId('ws-abc123-git-pull')).toBe('ws-git-pull');
  });

  it('parses workspace id with machineId::path and hyphens in path', () => {
    const a = parseWorkspaceCommandBlacklistKeyFromId(
      'ws-abc::/Users/foo/my-project/repo-git-pull'
    );
    expect(a).toBe('ws-git-pull');
  });

  it('different workspace ids for same action produce same key', () => {
    const a = parseWorkspaceCommandBlacklistKeyFromId('ws-m1::/Users/foo/my-project/repo-git-pull');
    const b = parseWorkspaceCommandBlacklistKeyFromId('ws-m2::/Users/bar/other-repo-git-pull');
    expect(a).toBe(b);
  });

  it('parses open-github-desktop with hyphens in path', () => {
    expect(parseWorkspaceCommandBlacklistKeyFromId('ws-abc::/path-open-github-desktop')).toBe(
      'ws-open-github-desktop'
    );
  });

  it('passes through already-semantic keys', () => {
    expect(parseWorkspaceCommandBlacklistKeyFromId('ws-git-pull')).toBe('ws-git-pull');
  });

  it('returns null for built-in commands', () => {
    expect(parseWorkspaceCommandBlacklistKeyFromId('nav-go-to-file')).toBeNull();
  });

  it('returns null for saved commands', () => {
    expect(parseWorkspaceCommandBlacklistKeyFromId('saved-cmd-id1')).toBeNull();
  });
});
