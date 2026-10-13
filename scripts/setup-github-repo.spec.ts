import { describe, expect, it } from 'bun:test';

import { shouldSkipGitHubRepoSetup } from './setup-github-repo';

describe('shouldSkipGitHubRepoSetup', () => {
  it('skips when origin is a non-template repo and no explicit URL', () => {
    expect(shouldSkipGitHubRepoSetup('https://github.com/my-team/my-app.git', null, false)).toBe(
      true
    );
  });

  it('does not skip when origin is the template repo', () => {
    expect(
      shouldSkipGitHubRepoSetup('https://github.com/conradkoh/next-convex-starter-app', null, false)
    ).toBe(false);
  });

  it('does not skip when origin is missing', () => {
    expect(shouldSkipGitHubRepoSetup(null, null, false)).toBe(false);
  });

  it('does not skip when explicit --repo-url is provided', () => {
    expect(
      shouldSkipGitHubRepoSetup(
        'https://github.com/my-team/my-app.git',
        'https://github.com/other/repo',
        false
      )
    ).toBe(false);
  });

  it('skips when --skip-github-repo flag is set', () => {
    expect(shouldSkipGitHubRepoSetup(null, null, true)).toBe(true);
  });
});
