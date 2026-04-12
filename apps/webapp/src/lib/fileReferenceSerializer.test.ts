import { describe, expect, it, afterEach } from 'vitest';

import {
  rawTextToHtml,
  htmlToRawText,
  domOffsetToRawOffset,
  setCursorToRawOffset,
  extractRawTextFromSelection,
} from './fileReferenceSerializer';
import { encodeFileReference } from './fileReference';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an HTMLDivElement from an HTML string (simulates contenteditable container). */
function createElement(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

/** Shorthand for a legacy file reference token. */
function fileToken(path: string): string {
  return `{file://workspace/${path}}`;
}

const PREFIX = 'ab12cd';

/** Shorthand for a new-format file reference token. */
function newToken(workspace: string, path: string): string {
  return encodeFileReference(workspace, path, PREFIX);
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

  it('renders file reference tokens as literal escaped text', () => {
    const html = rawTextToHtml(fileToken('index.ts'));
    // Should NOT contain chip spans — just escaped literal text
    expect(html).not.toContain('data-file-ref');
    expect(html).not.toContain('contenteditable="false"');
    expect(html).not.toContain('\u200B');
    // Should contain the escaped token text
    expect(html).toContain('file://workspace/index.ts');
  });

  it('renders file references inline with surrounding text', () => {
    const raw = `hello ${fileToken('a.ts')} world`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('data-file-ref');
    expect(html).toContain('hello');
    expect(html).toContain('world');
    expect(html).toContain('file://workspace/a.ts');
  });

  it('handles multiple file references as plain text', () => {
    const raw = `${fileToken('a.ts')} and ${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('data-file-ref');
    expect(html).not.toContain('\u200B');
    expect(html).toContain('file://workspace/a.ts');
    expect(html).toContain('file://workspace/b.ts');
  });

  it('handles file reference at the START of text', () => {
    const raw = `${fileToken('a.ts')} some text`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('\u200B');
    expect(html).toContain('file://workspace/a.ts');
  });

  it('handles file reference at the END of text', () => {
    const raw = `some text ${fileToken('a.ts')}`;
    const html = rawTextToHtml(raw);
    expect(html).toContain('file://workspace/a.ts');
  });

  it('handles adjacent file references (back to back)', () => {
    const raw = `${fileToken('a.ts')}${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    expect(html).not.toContain('\u200B');
    expect(html).toContain('file://workspace/a.ts');
    expect(html).toContain('file://workspace/b.ts');
  });
});

// ── rawTextToHtml with prefix (atomic spans) ───────────────────────────────

describe('rawTextToHtml with prefix', () => {
  it('returns plain escaped text when no tokens match prefix', () => {
    const html = rawTextToHtml('hello world', PREFIX);
    expect(html).toBe('hello world');
    expect(html).not.toContain('data-token');
  });

  it('renders a token as an atomic span', () => {
    const token = newToken('ws1', 'src/index.ts');
    const html = rawTextToHtml(token, PREFIX);
    expect(html).toContain('data-token');
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('class="file-ref-inline"');
    expect(html).toContain('>src/index.ts</span>');
  });

  it('renders surrounding text with a token', () => {
    const token = newToken('ws1', 'a.ts');
    const raw = `hello ${token} world`;
    const html = rawTextToHtml(raw, PREFIX);
    expect(html).toContain('hello ');
    expect(html).toContain(' world');
    expect(html).toContain('>a.ts</span>');
  });

  it('renders multiple tokens as spans', () => {
    const raw = `${newToken('ws', 'a.ts')} and ${newToken('ws', 'b.ts')}`;
    const html = rawTextToHtml(raw, PREFIX);
    expect(html).toContain('>a.ts</span>');
    expect(html).toContain('>b.ts</span>');
    expect(html).toContain(' and ');
  });

  it('handles newlines with tokens', () => {
    const raw = `line1\n${newToken('ws', 'file.ts')}\nline3`;
    const html = rawTextToHtml(raw, PREFIX);
    expect(html).toContain('<br>');
    expect(html).toContain('>file.ts</span>');
  });

  it('behaves like plain mode when prefix is undefined', () => {
    const token = newToken('ws', 'file.ts');
    const htmlNoPrefix = rawTextToHtml(token);
    expect(htmlNoPrefix).not.toContain('data-token');
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

  it('round-trips file reference token through HTML', () => {
    const token = fileToken('index.ts');
    const html = rawTextToHtml(token);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(token);
  });

  it('handles mixed text + file tokens correctly', () => {
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

  it('emits data-token value for token spans', () => {
    const token = newToken('ws1', 'src/index.ts');
    const html = rawTextToHtml(token, PREFIX);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(token);
  });

  it('round-trips text with token spans', () => {
    const token = newToken('ws', 'file.ts');
    const raw = `hello ${token} world`;
    const html = rawTextToHtml(raw, PREFIX);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(raw);
  });

  it('round-trips multiple token spans', () => {
    const raw = `${newToken('ws', 'a.ts')} and ${newToken('ws', 'b.ts')}`;
    const html = rawTextToHtml(raw, PREFIX);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(raw);
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

  it('returns full text length for cursor at end', () => {
    const el = createElement('hello world');
    expect(domOffsetToRawOffset(el, el, el.childNodes.length)).toBe('hello world'.length);
  });

  it('counts offset correctly in text with <br>', () => {
    const el = createElement('hello<br>world');
    // After <br>: "hello" (5) + newline (1) = 6
    // "world" text node is childNodes[2]
    const worldNode = el.childNodes[2]!;
    expect(domOffsetToRawOffset(el, worldNode, 3)).toBe(9); // 5 + 1 + 3
  });
});

// ── setCursorToRawOffset ─────────────────────────────────────────────────────

describe('setCursorToRawOffset', () => {
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

  it('extracts file token from selection', () => {
    const token = fileToken('index.ts');
    const el = createAndSelect(rawTextToHtml(token));
    selectAll(el);
    expect(extractRawTextFromSelection(el)).toBe(token);
  });

  it('extracts mixed text with file tokens', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createAndSelect(rawTextToHtml(raw));
    selectAll(el);
    expect(extractRawTextFromSelection(el)).toBe(raw);
  });

  it('extracts partial text selection', () => {
    const el = createAndSelect(rawTextToHtml('hello world'));
    // Select "llo wo" (offset 2 to 8)
    const textNode = el.childNodes[0]!;
    setSelection(textNode, 2, textNode, 8);
    expect(extractRawTextFromSelection(el)).toBe('llo wo');
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
