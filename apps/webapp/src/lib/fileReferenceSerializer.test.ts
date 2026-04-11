import { describe, expect, it, afterEach } from 'vitest';

import {
  rawTextToHtml,
  htmlToRawText,
  domOffsetToRawOffset,
  setCursorToRawOffset,
  extractRawTextFromSelection,
} from './fileReferenceSerializer';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an HTMLDivElement from an HTML string (simulates contenteditable container). */
function createElement(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

/** Shorthand for a file reference token. */
function fileToken(path: string): string {
  return `{file://workspace/${path}}`;
}

// ── rawTextToHtml ────────────────────────────────────────────────────────────

describe('rawTextToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(rawTextToHtml('')).toBe('');
  });

  it('returns HTML-escaped plain text when no file references', () => {
    expect(rawTextToHtml('hello <world> & "test"')).toBe(
      'hello &lt;world&gt; &amp; &quot;test&quot;'
    );
  });

  it('converts newlines to <br>', () => {
    expect(rawTextToHtml('line1\nline2')).toBe('line1<br>line2');
  });

  it('wraps a single file reference in a chip span', () => {
    const html = rawTextToHtml(fileToken('index.ts'));
    // Should contain the chip span with data-file-ref
    expect(html).toContain('data-file-ref');
    expect(html).toContain('contenteditable="false"');
    // Should NOT contain any ZWS characters
    expect(html).not.toContain('\u200B');
  });

  it('renders chip directly adjacent to surrounding text', () => {
    const raw = `hello ${fileToken('a.ts')} world`;
    const html = rawTextToHtml(raw);
    // No ZWS anywhere
    expect(html).not.toContain('\u200B');
    // Should contain the chip span
    expect(html).toContain('data-file-ref');
  });

  it('handles multiple file references without ZWS', () => {
    const raw = `${fileToken('a.ts')} and ${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    // No ZWS characters
    expect(html).not.toContain('\u200B');
    // Both chips present
    const chipCount = (html.match(/data-file-ref/g) || []).length;
    expect(chipCount).toBe(2);
  });

  it('handles file reference at the START of text', () => {
    const raw = `${fileToken('a.ts')} some text`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('\u200B');
    expect(html).toContain('data-file-ref');
  });

  it('handles file reference at the END of text', () => {
    const raw = `some text ${fileToken('a.ts')}`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('\u200B');
    expect(html).toContain('data-file-ref');
  });

  it('handles adjacent file references (back to back)', () => {
    const raw = `${fileToken('a.ts')}${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    // No ZWS characters
    expect(html).not.toContain('\u200B');
    // Both chips present
    const chipCount = (html.match(/data-file-ref/g) || []).length;
    expect(chipCount).toBe(2);
  });
});

// ── htmlToRawText ────────────────────────────────────────────────────────────

describe('htmlToRawText', () => {
  it('returns empty string for empty element', () => {
    expect(htmlToRawText(createElement(''))).toBe('');
  });

  it('returns plain text from text node', () => {
    expect(htmlToRawText(createElement('hello world'))).toBe('hello world');
  });

  it('extracts raw token from chip span', () => {
    const token = fileToken('index.ts');
    const html = rawTextToHtml(token);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(token);
  });

  it('handles mixed text + chips correctly', () => {
    const raw = `hello ${fileToken('a.ts')} world`;
    const html = rawTextToHtml(raw);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(raw);
  });

  it('handles <br> as newline', () => {
    const el = createElement('line1<br>line2');
    expect(htmlToRawText(el)).toBe('line1\nline2');
  });

  it('handles nested <div> as newline (contenteditable behavior)', () => {
    const el = createElement('line1<div>line2</div>');
    expect(htmlToRawText(el)).toBe('line1\nline2');
  });

  it('does not prepend newline for first-child div', () => {
    const el = createElement('<div>only line</div>');
    expect(htmlToRawText(el)).toBe('only line');
  });
});

// ── Round-trip integrity ─────────────────────────────────────────────────────

describe('serialization round-trip', () => {
  const roundTrip = (raw: string): string => {
    const html = rawTextToHtml(raw);
    const el = createElement(html);
    return htmlToRawText(el);
  };

  it('round-trips plain text', () => {
    expect(roundTrip('hello world')).toBe('hello world');
  });

  it('round-trips text with HTML special characters', () => {
    expect(roundTrip('a < b & c > d "e"')).toBe('a < b & c > d "e"');
  });

  it('round-trips a single file reference', () => {
    const raw = fileToken('src/index.ts');
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips text with a file reference in the middle', () => {
    const raw = `See ${fileToken('src/index.ts')} for details`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips multiple file references', () => {
    const raw = `${fileToken('a.ts')} and ${fileToken('b.ts')}`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips adjacent file references', () => {
    const raw = `${fileToken('a.ts')}${fileToken('b.ts')}`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips file reference at start of text', () => {
    const raw = `${fileToken('a.ts')} some text`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips file reference at end of text', () => {
    const raw = `some text ${fileToken('a.ts')}`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('round-trips text with newlines and file references', () => {
    const raw = `line1\n${fileToken('a.ts')}\nline3`;
    expect(roundTrip(raw)).toBe(raw);
  });

  it('ensures no ZWS leaks into raw text', () => {
    const raw = `hello ${fileToken('a.ts')} world`;
    const result = roundTrip(raw);
    expect(result).not.toContain('\u200B');
  });
});

// ── domOffsetToRawOffset ─────────────────────────────────────────────────────

describe('domOffsetToRawOffset', () => {
  it('returns correct offset for cursor in plain text', () => {
    const el = createElement('hello world');
    const textNode = el.childNodes[0]!;
    expect(domOffsetToRawOffset(el, textNode, 5)).toBe(5);
  });

  it('returns 0 for cursor at the start of plain text', () => {
    const el = createElement('hello');
    const textNode = el.childNodes[0]!;
    expect(domOffsetToRawOffset(el, textNode, 0)).toBe(0);
  });

  it('counts chip span as raw token length', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`hello ${token}`);
    const el = createElement(html);
    // After all children: "hello ".length + token.length
    expect(domOffsetToRawOffset(el, el, el.childNodes.length)).toBe(`hello ${token}`.length);
  });

  it('counts offset before chip correctly', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`hello ${token} world`);
    const el = createElement(html);
    // First text node is "hello "
    const firstTextNode = el.childNodes[0]!;
    // DOM offset 6 = "hello " (6 chars)
    expect(domOffsetToRawOffset(el, firstTextNode, 6)).toBe(6);
  });

  it('handles cursor inside chip (treated as end of chip)', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(token);
    const el = createElement(html);
    // The chip span is the first child (no ZWS text node before it)
    const chipSpan = el.childNodes[0]!;
    // Any anchor inside the chip should be treated as at the end of the raw token
    const innerNode = chipSpan.childNodes[0] || chipSpan;
    const result = domOffsetToRawOffset(el, innerNode, 0);
    expect(result).toBe(token.length);
  });

  it('handles cursor between two chips', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const raw = `${tokenA}${tokenB}`;
    const html = rawTextToHtml(raw);
    const el = createElement(html);
    // DOM structure: [chip_a][chip_b]
    // At container level offset 1 (after first child chip_a): raw = tokenA.length
    expect(domOffsetToRawOffset(el, el, 1)).toBe(tokenA.length);
  });

  it('calculates correct offset after chip + typed text (simulated typing)', () => {
    // After autocomplete inserts a chip, the DOM has:
    // [chip][text node with user typed content]
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`${token} `); // initial after autocomplete: chip + space
    const el = createElement(html);
    // Simulate typing by modifying the last text node (browser behavior)
    const lastTextNode = el.lastChild!;
    lastTextNode.textContent = ' hello @'; // browser appends to existing text node

    // Cursor at end of last text node
    const domOffset = lastTextNode.textContent!.length; // 8
    const rawOffset = domOffsetToRawOffset(el, lastTextNode, domOffset);
    // Expected: tokenLen + " hello @".length = tokenLen + 8
    expect(rawOffset).toBe(token.length + 8);
  });

  it('calculates correct offset when cursor is at start of text node after chip', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`${token} `);
    const el = createElement(html);
    const lastTextNode = el.lastChild!;
    lastTextNode.textContent = ' hello @';

    const rawOffset = domOffsetToRawOffset(el, lastTextNode, 0);
    // At start of text node after chip: raw offset = token.length
    expect(rawOffset).toBe(token.length);
  });
});

// ── setCursorToRawOffset ─────────────────────────────────────────────────────

describe('setCursorToRawOffset', () => {
  // Note: jsdom has limited Selection API support, but we can test
  // that the function doesn't throw and that it sets the selection.
  // We verify by reading back with domOffsetToRawOffset.

  it('sets cursor in plain text at correct position', () => {
    const el = createElement('hello world');
    document.body.appendChild(el);
    try {
      setCursorToRawOffset(el, 5);
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        const offset = domOffsetToRawOffset(el, selection.anchorNode, selection.anchorOffset);
        expect(offset).toBe(5);
      }
    } finally {
      document.body.removeChild(el);
    }
  });

  it('sets cursor at the start (offset 0)', () => {
    const el = createElement('hello');
    document.body.appendChild(el);
    try {
      setCursorToRawOffset(el, 0);
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        const offset = domOffsetToRawOffset(el, selection.anchorNode, selection.anchorOffset);
        expect(offset).toBe(0);
      }
    } finally {
      document.body.removeChild(el);
    }
  });

  it('sets cursor after a chip span', () => {
    const token = fileToken('a.ts');
    const raw = `${token} world`;
    const html = rawTextToHtml(raw);
    const el = createElement(html);
    document.body.appendChild(el);
    try {
      // Set cursor to end of token = token.length
      setCursorToRawOffset(el, token.length);
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        const offset = domOffsetToRawOffset(el, selection.anchorNode, selection.anchorOffset);
        expect(offset).toBe(token.length);
      }
    } finally {
      document.body.removeChild(el);
    }
  });

  it('does not throw when setting cursor past all content', () => {
    const el = createElement('hello');
    document.body.appendChild(el);
    try {
      // Should not throw — may place cursor at end
      expect(() => setCursorToRawOffset(el, 100)).not.toThrow();
    } finally {
      document.body.removeChild(el);
    }
  });
});

// ── extractRawTextFromSelection ──────────────────────────────────────────────

describe('extractRawTextFromSelection', () => {
  /** Create a container, append to body, and select a range within it. */
  function createAndSelect(html: string): HTMLDivElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }

  /** Select all content within a container. */
  function selectAll(container: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(container);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Set a selection range by offsets within text nodes. */
  function setSelection(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number
  ): void {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  afterEach(() => {
    // Clean up any containers we appended
    const editables = document.querySelectorAll('[contenteditable]');
    editables.forEach((el) => el.parentNode?.removeChild(el));
    window.getSelection()?.removeAllRanges();
  });

  it('returns null when no selection exists', () => {
    const el = createAndSelect(rawTextToHtml('hello'));
    window.getSelection()?.removeAllRanges();
    expect(extractRawTextFromSelection(el)).toBeNull();
  });

  it('returns null when selection is collapsed (no range selected)', () => {
    const el = createAndSelect(rawTextToHtml('hello'));
    const textNode = el.childNodes[0]!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(extractRawTextFromSelection(el)).toBeNull();
  });

  it('extracts plain text from selection', () => {
    const el = createAndSelect(rawTextToHtml('hello world'));
    selectAll(el);
    expect(extractRawTextFromSelection(el)).toBe('hello world');
  });

  it('extracts raw token from selected chip', () => {
    const token = fileToken('index.ts');
    const el = createAndSelect(rawTextToHtml(token));
    selectAll(el);
    expect(extractRawTextFromSelection(el)).toBe(token);
  });

  it('extracts mixed text + chip + text', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createAndSelect(rawTextToHtml(raw));
    selectAll(el);
    expect(extractRawTextFromSelection(el)).toBe(raw);
  });

  it('extracts partial text selection (no chip)', () => {
    const el = createAndSelect(rawTextToHtml('hello world'));
    // Select "llo wo" (offset 2 to 8)
    const textNode = el.childNodes[0]!;
    setSelection(textNode, 2, textNode, 8);
    expect(extractRawTextFromSelection(el)).toBe('llo wo');
  });

  it('extracts selection spanning text and chip', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createAndSelect(rawTextToHtml(raw));

    // Select from middle of "hello " through the chip to " world"
    // DOM: [text "hello "][chip span][text " world"]
    const firstTextNode = el.childNodes[0]!;
    const lastTextNode = el.childNodes[2]!;
    setSelection(firstTextNode, 3, lastTextNode, 3);
    const result = extractRawTextFromSelection(el);
    expect(result).toBe(`lo ${token} wo`);
  });

  it('returns null when selection is outside the container', () => {
    const el = createAndSelect(rawTextToHtml('hello'));
    const other = document.createElement('div');
    other.textContent = 'other';
    document.body.appendChild(other);

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(other);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(extractRawTextFromSelection(el)).toBeNull();
    document.body.removeChild(other);
  });
});
