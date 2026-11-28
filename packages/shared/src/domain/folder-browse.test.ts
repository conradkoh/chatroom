import { describe, expect, test } from 'vitest';

import {
  FOLDER_BROWSE_MAX_PATH_LENGTH,
  FolderBrowsePathError,
  folderBrowseNameBytes,
  normalizeBrowsePath,
} from './folder-browse';

describe('normalizeBrowsePath', () => {
  test.each([
    ['/', '/'],
    ['/tmp', '/tmp'],
    ['/tmp/', '/tmp'],
    ['  /tmp/work  ', '/tmp/work'],
    ['///tmp///work//', '/tmp/work'],
    ['/tmp/./work', '/tmp/work'],
    ['/tmp/My (old) #2', '/tmp/My (old) #2'],
    ['/tmp/ünïcode', '/tmp/ünïcode'],
    ['/' + 'a'.repeat(1023), '/' + 'a'.repeat(1023)],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeBrowsePath(input)).toBe(expected);
  });

  test.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['tmp', 'relative'],
    ['./tmp', 'dot-relative'],
    ['/tmp/../etc', 'traversal segment'],
    ['/..', 'traversal at root'],
    ['/tmp/a\nb', 'newline'],
    ['/tmp/a\rb', 'carriage return'],
    ['/tmp/a\0b', 'null byte'],
    ['/tmp/a\tb', 'tab'],
    ['/tmp/a\x1bb', 'escape'],
    ['/tmp/a\x7fb', 'delete'],
    ['/' + 'a'.repeat(1024), 'over the path cap'],
  ])('rejects %j (%s)', (input) => {
    expect(() => normalizeBrowsePath(input)).toThrow(FolderBrowsePathError);
  });

  test('accepts exactly the path cap', () => {
    const input = '/' + 'a'.repeat(FOLDER_BROWSE_MAX_PATH_LENGTH - 1);
    expect(normalizeBrowsePath(input)).toBe(input);
  });
});

describe('folderBrowseNameBytes', () => {
  test('sums UTF-8 bytes, not characters', () => {
    expect(folderBrowseNameBytes([{ name: 'ab' }, { name: 'é' }])).toBe(4);
    expect(folderBrowseNameBytes([])).toBe(0);
  });
});
