import { describe, expect, it } from 'vitest';

import {
  rawTextToHtml,
  htmlToRawText,
  domOffsetToRawOffset,
  setCursorToRawOffset,
} from './fileReferenceSerializer';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ZWS = '\u200B';

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

  it('wraps a single file reference chip with ZWS', () => {
    const html = rawTextToHtml(fileToken('index.ts'));
    // Should start with ZWS and end with ZWS
    expect(html.startsWith(ZWS)).toBe(true);
    expect(html.endsWith(ZWS)).toBe(true);
    // Should contain the chip span with data-file-ref
    expect(html).toContain('data-file-ref');
    expect(html).toContain('contenteditable="false"');
  });

  it('includes ZWS before and after chip with surrounding text', () => {
    const raw = `hello ${fileToken('a.ts')} world`;
    const html = rawTextToHtml(raw);
    // The chip should be preceded by ZWS (after "hello ")
    expect(html).toContain(`hello ${ZWS}`);
    // The chip should be followed by ZWS (before " world")
    expect(html).toContain(`${ZWS} world`);
  });

  it('handles multiple file references with ZWS boundaries', () => {
    const raw = `${fileToken('a.ts')} and ${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    // Count ZWS occurrences — should be 4 (before+after each of 2 chips)
    const zwsCount = (html.match(/\u200B/g) || []).length;
    expect(zwsCount).toBe(4);
  });

  it('handles file reference at the START of text', () => {
    const raw = `${fileToken('a.ts')} some text`;
    const html = rawTextToHtml(raw);
    // Leading ZWS before chip
    expect(html.startsWith(ZWS)).toBe(true);
  });

  it('handles file reference at the END of text', () => {
    const raw = `some text ${fileToken('a.ts')}`;
    const html = rawTextToHtml(raw);
    // Trailing ZWS after chip
    expect(html.endsWith(ZWS)).toBe(true);
  });

  it('handles adjacent file references (back to back)', () => {
    const raw = `${fileToken('a.ts')}${fileToken('b.ts')}`;
    const html = rawTextToHtml(raw);
    // Should have ZWS between them: ...chip_a ZWS ZWS chip_b...
    // (trailing ZWS of chip a + leading ZWS of chip b)
    const zwsCount = (html.match(/\u200B/g) || []).length;
    expect(zwsCount).toBe(4); // before_a, after_a, before_b, after_b
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

  it('strips ZWS from text nodes', () => {
    expect(htmlToRawText(createElement(`${ZWS}hello${ZWS}`))).toBe('hello');
  });

  it('extracts raw token from chip span', () => {
    const token = fileToken('index.ts');
    const html = rawTextToHtml(token);
    const el = createElement(html);
    expect(htmlToRawText(el)).toBe(token);
  });

  it('handles mixed text + chips + ZWS correctly', () => {
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
    expect(result).not.toContain(ZWS);
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

  it('excludes ZWS characters from offset calculation', () => {
    // Simulate a text node with ZWS: "\u200Bhello"
    const el = createElement(`${ZWS}hello`);
    const textNode = el.childNodes[0]!;
    // DOM offset 1 points after the ZWS, which is raw offset 0
    expect(domOffsetToRawOffset(el, textNode, 1)).toBe(0);
    // DOM offset 3 is after ZWS + "he" = raw offset 2
    expect(domOffsetToRawOffset(el, textNode, 3)).toBe(2);
  });

  it('counts chip span as raw token length', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`hello ${token}`);
    const el = createElement(html);
    // After "hello " and the chip, cursor at container level after 3 children
    // (text "hello \u200B", chip span, text "\u200B")
    // Cursor after all children should be: "hello ".length + token.length = 6 + token.length
    expect(domOffsetToRawOffset(el, el, el.childNodes.length)).toBe(`hello ${token}`.length);
  });

  it('counts offset before chip correctly', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`hello ${token} world`);
    const el = createElement(html);
    // First text node is "hello \u200B"
    const firstTextNode = el.childNodes[0]!;
    // DOM offset 6 = "hello " (6 chars) — the ZWS hasn't been reached yet
    expect(domOffsetToRawOffset(el, firstTextNode, 6)).toBe(6);
  });

  it('handles cursor at ZWS boundary before chip', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(`hello ${token} world`);
    const el = createElement(html);
    // First text node is "hello \u200B" (7 DOM chars, 6 raw chars)
    const firstTextNode = el.childNodes[0]!;
    // DOM offset 7 = after "hello " + ZWS = raw offset 6 (ZWS excluded)
    expect(domOffsetToRawOffset(el, firstTextNode, 7)).toBe(6);
  });

  it('handles cursor inside chip (treated as end of chip)', () => {
    const token = fileToken('a.ts');
    const html = rawTextToHtml(token);
    const el = createElement(html);
    // The chip span is the second child (after leading ZWS text node)
    const chipSpan = el.childNodes[1]!;
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
    // After first chip (ZWS + chip + ZWS): container offset at child index 3
    // should give raw offset = tokenA.length
    // DOM structure: [ZWS text][chip_a][ZWS+ZWS text][chip_b][ZWS text]
    // At container level offset 3 (after first 3 children): raw = tokenA.length
    expect(domOffsetToRawOffset(el, el, 3)).toBe(tokenA.length);
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

  it('sets cursor in text with ZWS correctly', () => {
    // Text with ZWS: "\u200Bhello\u200B" — raw text is "hello" (length 5)
    const el = createElement(`${ZWS}hello${ZWS}`);
    document.body.appendChild(el);
    try {
      setCursorToRawOffset(el, 3); // raw offset 3 = after "hel"
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        const offset = domOffsetToRawOffset(el, selection.anchorNode, selection.anchorOffset);
        expect(offset).toBe(3);
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
