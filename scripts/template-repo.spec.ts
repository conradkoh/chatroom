import { describe, expect, it } from 'bun:test';

import { isTemplateRemote } from './template-repo';

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
