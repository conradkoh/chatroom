import { describe, expect, it } from 'vitest';

import {
  internalToDisplay,
  buildTokenMap,
  internalOffsetToDisplay,
  displayOffsetToInternal,
  applyDisplayEdit,
  type TokenMapping,
} from './fileReferenceDisplay';
import { encodeFileReference } from './fileReference';

const PREFIX = 'ab12cd';

// Helper to build internal text with file references
function ref(workspace: string, filePath: string): string {
  return encodeFileReference(workspace, filePath, PREFIX);
}

// ── internalToDisplay ──────────────────────────────────────────────────────

describe('internalToDisplay', () => {
  it('returns text unchanged when there are no tokens', () => {
    expect(internalToDisplay('hello world', PREFIX)).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(internalToDisplay('', PREFIX)).toBe('');
  });

  it('replaces a single token with its file path', () => {
    const internal = `check ${ref('ws1', 'src/index.ts')} please`;
    expect(internalToDisplay(internal, PREFIX)).toBe('check src/index.ts please');
  });

  it('replaces multiple tokens', () => {
    const internal = `see ${ref('ws1', 'a.ts')} and ${ref('ws2', 'b.ts')}`;
    expect(internalToDisplay(internal, PREFIX)).toBe('see a.ts and b.ts');
  });

  it('handles token at the start of text', () => {
    const internal = `${ref('ws', 'file.ts')} is great`;
    expect(internalToDisplay(internal, PREFIX)).toBe('file.ts is great');
  });

  it('handles token at the end of text', () => {
    const internal = `see ${ref('ws', 'file.ts')}`;
    expect(internalToDisplay(internal, PREFIX)).toBe('see file.ts');
  });

  it('handles adjacent tokens', () => {
    const internal = `${ref('ws', 'a.ts')}${ref('ws', 'b.ts')}`;
    expect(internalToDisplay(internal, PREFIX)).toBe('a.tsb.ts');
  });

  it('handles escaped colons in workspace', () => {
    const internal = `file: ${ref('ws:name', 'path.ts')}`;
    expect(internalToDisplay(internal, PREFIX)).toBe('file: path.ts');
  });
});

// ── buildTokenMap ──────────────────────────────────────────────────────────

describe('buildTokenMap', () => {
  it('returns empty array for text with no tokens', () => {
    expect(buildTokenMap('hello', PREFIX)).toEqual([]);
  });

  it('returns empty array for empty text', () => {
    expect(buildTokenMap('', PREFIX)).toEqual([]);
  });

  it('maps a single token correctly', () => {
    const token = ref('ws1', 'src/index.ts');
    const internal = `check ${token} please`;
    const map = buildTokenMap(internal, PREFIX);

    expect(map).toHaveLength(1);
    expect(map[0]).toEqual({
      internalStart: 6, // after "check "
      internalEnd: 6 + token.length,
      displayStart: 6, // after "check "
      displayEnd: 6 + 'src/index.ts'.length,
      filePath: 'src/index.ts',
      fullToken: token,
    });
  });

  it('maps multiple tokens with correct offsets', () => {
    const token1 = ref('ws1', 'a.ts');
    const token2 = ref('ws2', 'b.ts');
    const internal = `see ${token1} and ${token2}`;
    const map = buildTokenMap(internal, PREFIX);

    expect(map).toHaveLength(2);

    // First token: after "see "
    expect(map[0].internalStart).toBe(4);
    expect(map[0].internalEnd).toBe(4 + token1.length);
    expect(map[0].displayStart).toBe(4);
    expect(map[0].displayEnd).toBe(4 + 'a.ts'.length);
    expect(map[0].filePath).toBe('a.ts');

    // Second token: after "see a.ts and " in display
    expect(map[1].internalStart).toBe(4 + token1.length + ' and '.length);
    expect(map[1].displayStart).toBe(4 + 'a.ts'.length + ' and '.length);
    expect(map[1].displayEnd).toBe(4 + 'a.ts'.length + ' and '.length + 'b.ts'.length);
    expect(map[1].filePath).toBe('b.ts');
  });

  it('handles token at start of text', () => {
    const token = ref('ws', 'file.ts');
    const internal = `${token} rest`;
    const map = buildTokenMap(internal, PREFIX);

    expect(map[0].internalStart).toBe(0);
    expect(map[0].displayStart).toBe(0);
    expect(map[0].displayEnd).toBe('file.ts'.length);
  });
});

// ── internalOffsetToDisplay ────────────────────────────────────────────────

describe('internalOffsetToDisplay', () => {
  it('returns same offset when no tokens exist', () => {
    const map: TokenMapping[] = [];
    expect(internalOffsetToDisplay(5, map)).toBe(5);
  });

  it('returns same offset for cursor before any token', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hello ${token}`;
    const map = buildTokenMap(internal, PREFIX);
    expect(internalOffsetToDisplay(3, map)).toBe(3); // inside "hello"
  });

  it('maps cursor at token start to display token start', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token}`;
    const map = buildTokenMap(internal, PREFIX);
    expect(internalOffsetToDisplay(3, map)).toBe(3);
  });

  it('clamps cursor inside a token to nearest display edge', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token} end`;
    const map = buildTokenMap(internal, PREFIX);

    // Cursor near start of token → display start
    expect(internalOffsetToDisplay(4, map)).toBe(3);

    // Cursor near end of token → display end
    expect(internalOffsetToDisplay(3 + token.length - 1, map)).toBe(3 + 'file.ts'.length);
  });

  it('adjusts offset after token correctly', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token} end`;
    const map = buildTokenMap(internal, PREFIX);

    // Just after token in internal
    const afterTokenInternal = 3 + token.length;
    const afterTokenDisplay = 3 + 'file.ts'.length;
    expect(internalOffsetToDisplay(afterTokenInternal, map)).toBe(afterTokenDisplay);
  });

  it('handles cursor at end of text', () => {
    const token = ref('ws', 'f.ts');
    const internal = `${token}`;
    const map = buildTokenMap(internal, PREFIX);
    expect(internalOffsetToDisplay(internal.length, map)).toBe('f.ts'.length);
  });

  it('handles cursor between two tokens', () => {
    const token1 = ref('ws', 'a.ts');
    const token2 = ref('ws', 'b.ts');
    const internal = `${token1} ${token2}`;
    const map = buildTokenMap(internal, PREFIX);

    // The space between tokens
    const spaceInternal = token1.length;
    const spaceDisplay = 'a.ts'.length;
    expect(internalOffsetToDisplay(spaceInternal, map)).toBe(spaceDisplay);
  });
});

// ── displayOffsetToInternal ────────────────────────────────────────────────

describe('displayOffsetToInternal', () => {
  it('returns same offset when no tokens exist', () => {
    const map: TokenMapping[] = [];
    expect(displayOffsetToInternal(5, map)).toBe(5);
  });

  it('returns same offset for cursor before any token', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hello ${token}`;
    const map = buildTokenMap(internal, PREFIX);
    expect(displayOffsetToInternal(3, map)).toBe(3);
  });

  it('maps cursor inside display token to corresponding internal position', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token}`;
    const map = buildTokenMap(internal, PREFIX);

    // Cursor at display start of token → internal start
    expect(displayOffsetToInternal(3, map)).toBe(3);

    // Cursor at display end of token → internal end
    expect(displayOffsetToInternal(3 + 'file.ts'.length, map)).toBe(3 + token.length);
  });

  it('maps cursor inside display file path to internal token start', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token} end`;
    const map = buildTokenMap(internal, PREFIX);

    // Cursor in middle of "file.ts" display text
    expect(displayOffsetToInternal(5, map)).toBe(3); // maps to token start
  });

  it('adjusts offset after token correctly', () => {
    const token = ref('ws', 'file.ts');
    const internal = `hi ${token} end`;
    const map = buildTokenMap(internal, PREFIX);

    const afterDisplay = 3 + 'file.ts'.length + 1; // space after token
    const afterInternal = 3 + token.length + 1;
    expect(displayOffsetToInternal(afterDisplay, map)).toBe(afterInternal);
  });
});

// ── applyDisplayEdit ───────────────────────────────────────────────────────

describe('applyDisplayEdit', () => {
  it('returns internal text unchanged when display is unchanged', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token} here`;
    const display = internalToDisplay(internal, PREFIX);
    expect(applyDisplayEdit(internal, PREFIX, display)).toBe(internal);
  });

  it('handles insertion in non-token region', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token} here`;
    const display = internalToDisplay(internal, PREFIX);

    // User types "XX" before "here": "see file.ts XXhere"
    const newDisplay = display.replace(' here', ' XXhere');
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe(`see ${token} XXhere`);
  });

  it('handles deletion in non-token region', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token} here`;
    const display = internalToDisplay(internal, PREFIX);

    // User deletes "see ": "file.ts here"
    const newDisplay = display.replace('see ', '');
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe(`${token} here`);
  });

  it('handles character insertion before a token', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token}`;
    const display = internalToDisplay(internal, PREFIX);

    // "see file.ts" → "see Xfile.ts"
    const newDisplay = 'see X' + display.slice(4);
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe(`see X${token}`);
  });

  it('removes entire token when file path is deleted from display', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token} here`;

    // User deletes the file path entirely: "see  here"
    const newDisplay = 'see  here';
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe('see  here');
  });

  it('removes entire token when file path is partially edited', () => {
    const token = ref('ws', 'file.ts');
    const internal = `see ${token} here`;

    // User edits "file.ts" to "fil": "see fil here"
    const newDisplay = 'see fil here';
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe('see fil here');
  });

  it('handles text with no tokens', () => {
    const internal = 'hello world';
    const newDisplay = 'hello brave world';
    expect(applyDisplayEdit(internal, PREFIX, newDisplay)).toBe('hello brave world');
  });

  it('handles empty internal text', () => {
    expect(applyDisplayEdit('', PREFIX, 'new text')).toBe('new text');
  });

  it('handles multiple tokens with edit between them', () => {
    const token1 = ref('ws', 'a.ts');
    const token2 = ref('ws', 'b.ts');
    const internal = `${token1} and ${token2}`;
    const display = internalToDisplay(internal, PREFIX);

    // "a.ts and b.ts" → "a.ts or b.ts"
    const newDisplay = display.replace(' and ', ' or ');
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe(`${token1} or ${token2}`);
  });

  it('handles deletion of one token among multiple', () => {
    const token1 = ref('ws', 'a.ts');
    const token2 = ref('ws', 'b.ts');
    const internal = `${token1} and ${token2}`;

    // "a.ts and b.ts" → "a.ts and " (user deletes second file ref)
    const newDisplay = 'a.ts and ';
    const result = applyDisplayEdit(internal, PREFIX, newDisplay);
    expect(result).toBe(`${token1} and `);
  });
});
