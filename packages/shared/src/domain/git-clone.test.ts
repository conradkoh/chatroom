import { describe, expect, test } from 'vitest';

import {
  GIT_CLONE_MAX_URL_LENGTH,
  deriveRepoFolderName,
  joinClonePath,
  validateGitCloneUrl,
} from './git-clone';

describe('validateGitCloneUrl', () => {
  test.each([
    ['https://github.com/acme/my-repo.git'],
    ['http://git.example.com/team/project'],
    ['ssh://git@github.com/acme/my-repo.git'],
    ['ssh://git@example.com:2222/acme/my-repo.git'],
    ['git://github.com/acme/my-repo.git'],
    ['git@github.com:acme/my-repo.git'],
    ['  https://github.com/acme/my-repo.git  '],
  ])('accepts %s', (url) => {
    const result = validateGitCloneUrl(url);
    expect(result).toEqual({ ok: true, url: url.trim() });
  });

  test.each([
    ['ext::sh -c x', 'ext:: transport'],
    ['fd::17/foo', 'fd:: transport'],
    ['-uhttps://x', 'leading dash'],
    ['--upload-pack=touch /tmp/x', 'leading dash option'],
    ['file:///tmp/x', 'file scheme'],
    ['/tmp/repo', 'bare local path'],
    ['./repo', 'relative local path'],
    ['https://github.com/acme/my repo.git', 'whitespace'],
    ['https://github.com/acme/repo\n.git', 'newline'],
    ['https://github.com/acme/repo\u0000.git', 'NUL'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['https://github.com/', 'no repository path'],
    ['ssh://-oProxyCommand=x/acme/repo', 'host starting with dash'],
    ['git@-host:acme/repo.git', 'scp host starting with dash'],
  ])('rejects %s (%s)', (url) => {
    expect(validateGitCloneUrl(url).ok).toBe(false);
  });

  test('rejects a URL one character over the maximum length', () => {
    const prefix = 'https://x.io/';
    const url = prefix + 'a'.repeat(GIT_CLONE_MAX_URL_LENGTH + 1 - prefix.length);
    expect(url.length).toBe(GIT_CLONE_MAX_URL_LENGTH + 1);
    expect(validateGitCloneUrl(url).ok).toBe(false);
  });

  test('accepts a URL exactly at the maximum length', () => {
    const prefix = 'https://x.io/';
    const url = prefix + 'a'.repeat(GIT_CLONE_MAX_URL_LENGTH - prefix.length);
    expect(url.length).toBe(GIT_CLONE_MAX_URL_LENGTH);
    expect(validateGitCloneUrl(url).ok).toBe(true);
  });
});

describe('deriveRepoFolderName', () => {
  test.each([
    ['https://github.com/acme/my-repo.git', 'my-repo'],
    ['https://github.com/acme/my-repo', 'my-repo'],
    ['https://github.com/acme/my-repo/', 'my-repo'],
    ['https://github.com/acme/my-repo.git/', 'my-repo'],
    ['git@github.com:acme/x.git/', 'x'],
    ['git@github.com:acme/x.git', 'x'],
    ['ssh://git@example.com:2222/acme/tools.v2.git', 'tools.v2'],
    ['https://github.com/acme/my repo (copy).git', 'my-repo--copy-'],
    ['https://github.com/acme/ünïcode.git', '-n-code'],
    ['https://github.com/acme/.hidden.git', 'hidden'],
  ])('derives folder name from %s', (url, expected) => {
    expect(deriveRepoFolderName(url)).toBe(expected);
  });

  test.each([
    [''],
    ['/'],
    ['https://github.com/acme/..'],
    ['https://github.com/acme/..git'],
    ['https://github.com/acme/.git'],
    ['https://github.com/acme/.'],
  ])('returns null when no usable name remains for %s', (url) => {
    expect(deriveRepoFolderName(url)).toBeNull();
  });
});

describe('joinClonePath', () => {
  test('joins parent and folder name', () => {
    expect(joinClonePath('/Users/me/src', 'my-repo')).toBe('/Users/me/src/my-repo');
  });

  test('strips trailing slashes from the parent', () => {
    expect(joinClonePath('/Users/me/src/', 'my-repo')).toBe('/Users/me/src/my-repo');
    expect(joinClonePath('/Users/me/src///', 'my-repo')).toBe('/Users/me/src/my-repo');
  });

  test('handles the filesystem root parent', () => {
    expect(joinClonePath('/', 'my-repo')).toBe('/my-repo');
  });
});
