import { describe, expect, it, afterEach } from 'vitest';
import {
  rawTextToHtml,
  htmlToRawText,
  extractRawTextFromSelection,
} from '@/lib/fileReferenceSerializer';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shorthand for a file reference token. */
function fileToken(path: string): string {
  return `{file://workspace/${path}}`;
}

/** Create a contenteditable container from raw text and append to body. */
function createContainer(raw: string): HTMLDivElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = rawTextToHtml(raw);
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

/**
 * Simulate the copy handler logic:
 * extracts raw text from selection and returns clipboard data entries.
 */
function simulateCopy(container: HTMLElement): { plain: string; raw: string } | null {
  const rawText = extractRawTextFromSelection(container);
  if (rawText == null) return null;
  return { plain: rawText, raw: rawText };
}

/**
 * Simulate the cut handler logic:
 * extracts raw text, deletes selection, returns clipboard data entries.
 */
function simulateCut(container: HTMLElement): { plain: string; raw: string } | null {
  const rawText = extractRawTextFromSelection(container);
  if (rawText == null) return null;

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
  }

  return { plain: rawText, raw: rawText };
}

/**
 * Simulate the paste handler with chatroom raw data:
 * inserts HTML reconstructed from raw text at cursor position.
 */
function simulatePasteRaw(_container: HTMLElement, rawText: string): void {
  const html = rawTextToHtml(rawText);
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * Simulate the paste handler with plain text only (no chatroom raw data):
 * inserts a text node at cursor position.
 */
function simulatePastePlain(_container: HTMLElement, text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Place cursor at end of container. */
function setCursorAtEnd(container: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(container);
  range.collapse(false); // collapse to end
  selection.removeAllRanges();
  selection.addRange(range);
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  const editables = document.querySelectorAll('[contenteditable]');
  editables.forEach((el) => el.parentNode?.removeChild(el));
  window.getSelection()?.removeAllRanges();
});

// ── Copy handler tests ──────────────────────────────────────────────────────

describe('Copy handler', () => {
  it('sets both text/plain and text/x-chatroom-raw with raw text', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createContainer(raw);
    selectAll(el);

    const clipboard = simulateCopy(el);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.plain).toBe(raw);
    expect(clipboard!.raw).toBe(raw);
  });

  it('returns null when no selection (collapsed cursor)', () => {
    const el = createContainer('hello world');
    setCursorAtEnd(el);

    const clipboard = simulateCopy(el);
    expect(clipboard).toBeNull();
  });

  it('extracts only selected text with chips', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createContainer(raw);

    // Select just the chip and surrounding space
    // DOM: [text "hello "][chip][text " world"]
    const chipSpan = el.querySelector('[data-file-ref]')!;
    const afterText = el.childNodes[2]!;

    const selection = window.getSelection()!;
    const range = document.createRange();
    // Start right before chip span
    range.setStartBefore(chipSpan);
    // End after " " in " world" (offset 1)
    range.setEnd(afterText, 1);
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboard = simulateCopy(el);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.plain).toBe(`${token} `);
  });
});

// ── Cut handler tests ────────────────────────────────────────────────────────

describe('Cut handler', () => {
  it('sets clipboard AND removes content from DOM', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createContainer(raw);
    selectAll(el);

    const clipboard = simulateCut(el);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.plain).toBe(raw);
    expect(clipboard!.raw).toBe(raw);

    // DOM should be empty after cut
    const remaining = htmlToRawText(el);
    expect(remaining).toBe('');
  });

  it('removes only selected content', () => {
    const token = fileToken('a.ts');
    const raw = `hello ${token} world`;
    const el = createContainer(raw);

    // Select just the chip
    const chipSpan = el.querySelector('[data-file-ref]')!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNode(chipSpan);
    selection.removeAllRanges();
    selection.addRange(range);

    const clipboard = simulateCut(el);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.plain).toBe(token);

    // The chip should be removed, leaving "hello  world"
    const remaining = htmlToRawText(el);
    expect(remaining).toBe('hello  world');
  });
});

// ── Paste handler tests ─────────────────────────────────────────────────────

describe('Paste handler', () => {
  it('reconstructs chips in DOM when pasting text/x-chatroom-raw', () => {
    const token = fileToken('a.ts');
    const rawToPaste = `see ${token} here`;

    const el = createContainer('');
    setCursorAtEnd(el);

    simulatePasteRaw(el, rawToPaste);

    // Verify chips were reconstructed
    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(1);
    expect(chips[0]!.getAttribute('data-file-ref')).toBe(token);

    // Verify full raw text round-trip
    const result = htmlToRawText(el);
    expect(result).toBe(rawToPaste);
  });

  it('inserts plain text when pasting without chatroom raw data', () => {
    const token = fileToken('a.ts');
    const el = createContainer('');
    setCursorAtEnd(el);

    // Paste just the token as plain text — should NOT create a chip
    simulatePastePlain(el, token);

    // Verify NO chip was created (token is just text)
    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(0);

    // The raw text should still be the token string
    const result = htmlToRawText(el);
    expect(result).toBe(token);
  });

  it('pastes chips into existing content at cursor position', () => {
    const token = fileToken('b.ts');
    const el = createContainer('start end');
    // Position cursor after "start " (offset 6)
    const textNode = el.childNodes[0]!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    simulatePasteRaw(el, token);

    const result = htmlToRawText(el);
    expect(result).toBe(`start ${token}end`);
  });

  it('replaces selection when pasting with chatroom raw data', () => {
    const token = fileToken('a.ts');
    const el = createContainer('hello world');
    // Select "world"
    const textNode = el.childNodes[0]!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    selection.removeAllRanges();
    selection.addRange(range);

    simulatePasteRaw(el, token);

    const result = htmlToRawText(el);
    expect(result).toBe(`hello ${token}`);
  });
});

// ── Round-trip tests ─────────────────────────────────────────────────────────

describe('Copy-paste round-trip', () => {
  it('round-trips: type text with chip → select all → copy → clear → paste → content identical', () => {
    const token = fileToken('a.ts');
    const original = `hello ${token} world`;
    const el = createContainer(original);

    // 1. Select all
    selectAll(el);

    // 2. Copy
    const clipboard = simulateCopy(el);
    expect(clipboard).not.toBeNull();

    // 3. Clear the container
    el.innerHTML = '';

    // 4. Paste with chatroom raw data
    setCursorAtEnd(el);
    simulatePasteRaw(el, clipboard!.raw);

    // 5. Verify content is identical
    const result = htmlToRawText(el);
    expect(result).toBe(original);

    // 6. Verify chips are intact
    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(1);
    expect(chips[0]!.getAttribute('data-file-ref')).toBe(token);
  });

  it('round-trips multiple chips', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const original = `${tokenA} and ${tokenB}`;
    const el = createContainer(original);

    selectAll(el);
    const clipboard = simulateCopy(el);
    expect(clipboard).not.toBeNull();

    el.innerHTML = '';
    setCursorAtEnd(el);
    simulatePasteRaw(el, clipboard!.raw);

    const result = htmlToRawText(el);
    expect(result).toBe(original);

    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(2);
  });

  it('round-trips cut and paste (move content)', () => {
    const token = fileToken('a.ts');
    const original = `hello ${token} world`;
    const el = createContainer(original);

    // Select all and cut
    selectAll(el);
    const clipboard = simulateCut(el);
    expect(clipboard).not.toBeNull();
    expect(htmlToRawText(el)).toBe('');

    // Paste back
    setCursorAtEnd(el);
    simulatePasteRaw(el, clipboard!.raw);

    const result = htmlToRawText(el);
    expect(result).toBe(original);
  });

  it('round-trips partial selection with chip', () => {
    const token = fileToken('a.ts');
    const raw = `prefix ${token} suffix`;
    const el = createContainer(raw);

    // Select from "fix " through chip to " suf"
    const firstTextNode = el.childNodes[0]!; // "prefix "
    const lastTextNode = el.childNodes[2]!; // " suffix"
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(firstTextNode, 3); // after "pre"
    range.setEnd(lastTextNode, 4); // " suf"
    selection.removeAllRanges();
    selection.addRange(range);

    // Copy
    const clipboard = simulateCopy(el);
    expect(clipboard).not.toBeNull();
    expect(clipboard!.plain).toBe(`fix ${token} suf`);

    // Paste into an empty container
    const target = createContainer('');
    setCursorAtEnd(target);
    simulatePasteRaw(target, clipboard!.raw);

    const result = htmlToRawText(target);
    expect(result).toBe(`fix ${token} suf`);

    // Verify chip is preserved
    const chips = target.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(1);
  });
});
