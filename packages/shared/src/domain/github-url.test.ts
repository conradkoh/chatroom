import { describe, expect, it } from 'vitest';

import { parseGitHubOwnerRepo } from './github-url';

describe('parseGitHubOwnerRepo', () => {
  it('parses HTTPS forms', () => {
    expect(parseGitHubOwnerRepo('https://github.com/acme/widget')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
    expect(parseGitHubOwnerRepo('https://github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('parses SSH forms', () => {
    expect(parseGitHubOwnerRepo('git@github.com:acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
    expect(parseGitHubOwnerRepo('ssh://git@github.com/acme/widget.git')).toEqual({
      owner: 'acme',
      repo: 'widget',
    });
  });

  it('rejects lookalike hosts, extra path segments, and invalid values', () => {
    expect(parseGitHubOwnerRepo('https://evilgithub.com/acme/widget')).toBeNull();
    expect(parseGitHubOwnerRepo('https://github.com/acme/widget/extra')).toBeNull();
    expect(parseGitHubOwnerRepo('https://gitlab.com/acme/widget')).toBeNull();
    expect(parseGitHubOwnerRepo('not-a-url')).toBeNull();
    expect(parseGitHubOwnerRepo('')).toBeNull();
  });
});
