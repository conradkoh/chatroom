import { describe, expect, test } from 'vitest';
import { resolveDownloadOutputDir } from './download.js';

describe('resolveDownloadOutputDir', () => {
  test('resolves absolute path under cwd', () => {
    const path = resolveDownloadOutputDir('linear', '/home/user/project');
    expect(path).toMatch(/^\/home\/user\/project\/\.chatroom\/downloads\/messages\/linear\//);
    expect(path).not.toMatch(/^\./);
  });
});
