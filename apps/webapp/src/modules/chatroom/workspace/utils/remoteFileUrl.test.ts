import { describe, expect, it } from 'vitest';

import { buildRemoteFileUrl } from './remoteFileUrl';

describe('buildRemoteFileUrl', () => {
  it('encodes special characters in path segments', () => {
    expect(buildRemoteFileUrl('https://github.com/owner/repo', 'main', 'src/foo bar.ts')).toBe(
      'https://github.com/owner/repo/blob/main/src/foo%20bar.ts'
    );
  });

  it('builds a blob URL without selection', () => {
    expect(buildRemoteFileUrl('https://github.com/owner/repo', 'main', 'src/index.ts')).toBe(
      'https://github.com/owner/repo/blob/main/src/index.ts'
    );
  });

  it('appends a text fragment when selection is provided', () => {
    expect(
      buildRemoteFileUrl('https://github.com/owner/repo', 'feat/x', 'src/a.ts', 'hello world')
    ).toBe('https://github.com/owner/repo/blob/feat%2Fx/src/a.ts#:~:text=hello%20world');
  });
});
