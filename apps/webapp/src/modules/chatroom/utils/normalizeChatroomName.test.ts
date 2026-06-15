import { describe, expect, test } from 'vitest';

import { normalizePastedChatroomName } from './normalizeChatroomName';

describe('normalizePastedChatroomName', () => {
  test('returns plain name unchanged', () => {
    expect(normalizePastedChatroomName('my-project')).toBe('my-project');
  });

  test('strips unix path', () => {
    expect(normalizePastedChatroomName('/Users/foo/my-project')).toBe('my-project');
  });

  test('strips windows path', () => {
    expect(normalizePastedChatroomName('C:\\Users\\foo\\my-project')).toBe('my-project');
  });

  test('strips trailing slash', () => {
    expect(normalizePastedChatroomName('/Users/foo/my-project/')).toBe('my-project');
  });
});
