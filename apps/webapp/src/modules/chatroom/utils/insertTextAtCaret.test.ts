import { describe, expect, it } from 'vitest';

import { insertMultipleAtCaret, insertTextAtCaret } from './insertTextAtCaret';

describe('insertTextAtCaret', () => {
  it('inserts at the start with trailing space before existing text', () => {
    expect(insertTextAtCaret('world', 0, 'hello')).toEqual({
      newText: 'hello world',
      newCursorPos: 6,
    });
  });

  it('adds spaces around mid-text insertions', () => {
    expect(insertTextAtCaret('hello world', 5, 'there')).toEqual({
      newText: 'hello there world',
      newCursorPos: 11,
    });
  });
});

describe('insertMultipleAtCaret', () => {
  it('joins multiple insertions with spaces', () => {
    expect(insertMultipleAtCaret('prefix ', 7, ['a.txt', 'b.txt'])).toEqual({
      newText: 'prefix a.txt b.txt',
      newCursorPos: 18,
    });
  });
});
