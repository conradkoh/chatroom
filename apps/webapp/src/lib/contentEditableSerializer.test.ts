import { describe, expect, it, beforeEach } from 'vitest';

import {
  rawTextToHtml,
  htmlToRawText,
  domOffsetToRawOffset,
  setCursorToRawOffset,
} from './contentEditableSerializer';

// ── rawTextToHtml ────────────────────────────────────────────────────────────

describe('rawTextToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(rawTextToHtml('')).toBe('');
  });

  it('returns empty string for falsy input', () => {
     
    expect(rawTextToHtml(undefined as any)).toBe('');
  });

  it('converts plain text without changes', () => {
    expect(rawTextToHtml('hello world')).toBe('hello world');
  });

  it('converts newlines to <br>', () => {
    expect(rawTextToHtml('line1\nline2')).toBe('line1<br>line2');
  });

  it('converts multiple newlines', () => {
    expect(rawTextToHtml('a\n\nb')).toBe('a<br><br>b');
  });

  it('escapes HTML special characters', () => {
    expect(rawTextToHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(rawTextToHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('handles mixed HTML entities and newlines', () => {
    expect(rawTextToHtml('<b>bold</b>\nnext')).toBe('&lt;b&gt;bold&lt;/b&gt;<br>next');
  });
});

// ── htmlToRawText ────────────────────────────────────────────────────────────

describe('htmlToRawText', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('returns empty string for empty element', () => {
    expect(htmlToRawText(container)).toBe('');
  });

  it('extracts text from text nodes', () => {
    container.textContent = 'hello world';
    expect(htmlToRawText(container)).toBe('hello world');
  });

  it('converts <br> to newline', () => {
    container.innerHTML = 'line1<br>line2';
    expect(htmlToRawText(container)).toBe('line1\nline2');
  });

  it('converts <div> to newline (contenteditable line break)', () => {
    container.innerHTML = 'line1<div>line2</div>';
    expect(htmlToRawText(container)).toBe('line1\nline2');
  });

  it('does not prepend newline for first-child div', () => {
    container.innerHTML = '<div>only line</div>';
    expect(htmlToRawText(container)).toBe('only line');
  });

  it('handles multiple divs', () => {
    container.innerHTML = '<div>a</div><div>b</div><div>c</div>';
    expect(htmlToRawText(container)).toBe('a\nb\nc');
  });

  it('handles nested elements by recursing', () => {
    container.innerHTML = '<span>hello</span> <span>world</span>';
    expect(htmlToRawText(container)).toBe('hello world');
  });

  it('strips HTML tags and returns text content', () => {
    container.innerHTML = '<b>bold</b> and <i>italic</i>';
    expect(htmlToRawText(container)).toBe('bold and italic');
  });
});

// ── domOffsetToRawOffset ─────────────────────────────────────────────────────

describe('domOffsetToRawOffset', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
  });

  it('returns 0 for cursor at start of text node', () => {
    container.textContent = 'hello';
    const textNode = container.childNodes[0]!;
    expect(domOffsetToRawOffset(container, textNode, 0)).toBe(0);
  });

  it('returns correct offset within a text node', () => {
    container.textContent = 'hello';
    const textNode = container.childNodes[0]!;
    expect(domOffsetToRawOffset(container, textNode, 3)).toBe(3);
  });

  it('counts <br> as 1 character', () => {
    container.innerHTML = 'abc<br>def';
    // "abc" (3 chars) + <br> (1 char) = 4, cursor at start of "def"
    const defNode = container.childNodes[2]!; // text node "def"
    expect(domOffsetToRawOffset(container, defNode, 0)).toBe(4);
  });

  it('counts <div> newline for non-first-child divs', () => {
    container.innerHTML = 'abc<div>def</div>';
    // "abc" (3 chars) + div newline (1 char) = 4, cursor at start of "def"
    const div = container.querySelector('div')!;
    const textNode = div.childNodes[0]!;
    expect(domOffsetToRawOffset(container, textNode, 0)).toBe(4);
  });

  it('handles cursor at end of text', () => {
    container.textContent = 'hello';
    const textNode = container.childNodes[0]!;
    expect(domOffsetToRawOffset(container, textNode, 5)).toBe(5);
  });

  it('handles element node anchor (cursor between children)', () => {
    container.innerHTML = 'abc<br>def';
    // anchorNode = container, anchorOffset = 2 (after "abc" text and <br>)
    expect(domOffsetToRawOffset(container, container, 2)).toBe(4); // 3 + 1
  });
});

// ── setCursorToRawOffset ─────────────────────────────────────────────────────

describe('setCursorToRawOffset', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    container.contentEditable = 'true';
    container.focus();
  });

  it('sets cursor in a simple text node', () => {
    container.textContent = 'hello world';
    setCursorToRawOffset(container, 5);

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    expect(sel!.rangeCount).toBe(1);
    const range = sel!.getRangeAt(0);
    expect(range.startOffset).toBe(5);
  });

  it('sets cursor at start (offset 0)', () => {
    container.textContent = 'hello';
    setCursorToRawOffset(container, 0);

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    expect(sel!.getRangeAt(0).startOffset).toBe(0);
  });

  it('sets cursor after <br>', () => {
    container.innerHTML = 'abc<br>def';
    setCursorToRawOffset(container, 4); // after "abc\n"

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    // After <br>, the cursor is placed at child index after the <br> element
    const range = sel!.getRangeAt(0);
    // Verify we can read back the correct offset
    const readBack = domOffsetToRawOffset(container, range.startContainer, range.startOffset);
    expect(readBack).toBe(4);
  });
});
