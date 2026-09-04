import { describe, expect, it } from 'bun:test';

import { isTemplateRemote, parseGitHubOwnerRepo } from './template-repo';

describe('parseGitHubOwnerRepo', () => {
  it('parses canonical HTTPS forms', () => {
    expect(parseGitHubOwnerRepo('https://github.com/conradkoh/next-convex-starter-app')).toEqual({
      owner: 'conradkoh',
      repo: 'next-convex-starter-app',
    });
    expect(
      parseGitHubOwnerRepo('https://github.com/conradkoh/next-convex-starter-app.git')
    ).toEqual({
      owner: 'conradkoh',
      repo: 'next-convex-starter-app',
    });
  });

  it('parses SSH forms', () => {
    expect(parseGitHubOwnerRepo('git@github.com:conradkoh/next-convex-starter-app.git')).toEqual({
      owner: 'conradkoh',
      repo: 'next-convex-starter-app',
    });
    expect(
      parseGitHubOwnerRepo('ssh://git@github.com/conradkoh/next-convex-starter-app.git')
    ).toEqual({
      owner: 'conradkoh',
      repo: 'next-convex-starter-app',
    });
  });

  it('rejects lookalike hosts, non-URLs, and extra path segments', () => {
    expect(
      parseGitHubOwnerRepo('https://evilgithub.com/conradkoh/next-convex-starter-app.git')
    ).toBeNull();
    expect(
      parseGitHubOwnerRepo('not-a-url-github.com/conradkoh/next-convex-starter-app')
    ).toBeNull();
    expect(
      parseGitHubOwnerRepo('https://github.com/conradkoh/next-convex-starter-app/extra')
    ).toBeNull();
    expect(
      parseGitHubOwnerRepo('https://gitlab.com/conradkoh/next-convex-starter-app.git')
    ).toBeNull();
    expect(parseGitHubOwnerRepo('')).toBeNull();
  });
});

describe('isTemplateRemote', () => {
  it('matches the canonical template repo across forms', () => {
    expect(isTemplateRemote('https://github.com/conradkoh/next-convex-starter-app')).toBe(true);
    expect(isTemplateRemote('https://github.com/conradkoh/next-convex-starter-app.git')).toBe(true);
    expect(isTemplateRemote('git@github.com:conradkoh/next-convex-starter-app.git')).toBe(true);
  });

  it('rejects forks, lookalike hosts, and unknown URLs (fail closed)', () => {
    expect(isTemplateRemote('https://github.com/someone-else/next-convex-starter-app.git')).toBe(
      false
    );
    expect(isTemplateRemote('https://evilgithub.com/conradkoh/next-convex-starter-app.git')).toBe(
      false
    );
    expect(isTemplateRemote('https://github.com/conradkoh/next-convex-starter-app/extra')).toBe(
      false
    );
    expect(isTemplateRemote('')).toBe(false);
    expect(isTemplateRemote(null)).toBe(false);
    expect(isTemplateRemote(undefined)).toBe(false);
  });
});
