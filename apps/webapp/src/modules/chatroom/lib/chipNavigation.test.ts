import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rawTextToHtml } from '@/lib/fileReferenceSerializer';
import {
  handleChipNavigation,
  isChipNode,
  getAdjacentChip,
  findWordBoundary,
} from './chipNavigation';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an HTMLDivElement from an HTML string and append to document body. */
function createContainer(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/** Create container from raw text (with file tokens) using the serializer. */
function createFromRaw(raw: string): HTMLDivElement {
  return createContainer(rawTextToHtml(raw));
}

/** Shorthand for a file reference token. */
function fileToken(path: string): string {
  return `{file://workspace/${path}}`;
}

/** Set cursor to a specific position in the container. */
function setCursor(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Get current cursor position as { node, offset }. */
function getCursor(): { node: Node; offset: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  return { node: selection.anchorNode!, offset: selection.anchorOffset };
}

/** Create a KeyboardEvent for testing. */
function makeKeyEvent(
  key: string,
  options?: { altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    altKey: options?.altKey ?? false,
    metaKey: options?.metaKey ?? false,
    shiftKey: options?.shiftKey ?? false,
    bubbles: true,
  });
}

/** Compute raw offset from current cursor position. */
function getRawOffset(container: HTMLElement): number {
  const cursor = getCursor();
  if (!cursor) return -1;

  let offset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;
    if (node === cursor!.node) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += cursor!.offset;
      } else {
        for (let i = 0; i < cursor!.offset && i < node.childNodes.length; i++) {
          accumulateLength(node.childNodes[i]!);
        }
      }
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? '').length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        if (el.contains(cursor!.node)) {
          offset += fileRef.length;
          found = true;
          return true;
        }
        offset += fileRef.length;
        return false;
      }
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }
    return false;
  }

  function accumulateLength(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? '').length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        offset += fileRef.length;
        return;
      }
      for (const child of Array.from(el.childNodes)) {
        accumulateLength(child);
      }
    }
  }

  walk(container);
  return offset;
}

// Track containers for cleanup
let containers: HTMLDivElement[] = [];

beforeEach(() => {
  containers = [];
});

afterEach(() => {
  for (const el of containers) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  containers = [];
});

/** Wrapper that tracks containers for cleanup. */
function makeContainer(raw: string): HTMLDivElement {
  const el = createFromRaw(raw);
  containers.push(el);
  return el;
}

function makeContainerHtml(html: string): HTMLDivElement {
  const el = createContainer(html);
  containers.push(el);
  return el;
}

// ── isChipNode ───────────────────────────────────────────────────────────────

describe('isChipNode', () => {
  it('returns true for a chip span with data-file-ref', () => {
    const el = makeContainer(fileToken('a.ts'));
    const chip = el.querySelector('[data-file-ref]')!;
    expect(isChipNode(chip)).toBe(true);
  });

  it('returns false for a plain text node', () => {
    const el = makeContainer('hello');
    expect(isChipNode(el.childNodes[0]!)).toBe(false);
  });

  it('returns false for a regular span without data-file-ref', () => {
    const el = makeContainerHtml('<span>test</span>');
    expect(isChipNode(el.childNodes[0]!)).toBe(false);
  });
});

// ── getAdjacentChip ──────────────────────────────────────────────────────────

describe('getAdjacentChip', () => {
  it('finds chip after cursor when cursor is at end of preceding text node', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token}`);
    // First child is text "hello ", set cursor at end
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 6); // end of "hello "
    expect(getAdjacentChip(el, 'after')).not.toBeNull();
  });

  it('finds chip before cursor when cursor is at start of following text node', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} hello`);
    // After chip, there should be a text node " hello"
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 0);
    expect(getAdjacentChip(el, 'before')).not.toBeNull();
  });

  it('returns null when no chip is adjacent (before)', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);
    expect(getAdjacentChip(el, 'before')).toBeNull();
  });

  it('returns null when no chip is adjacent (after)', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);
    expect(getAdjacentChip(el, 'after')).toBeNull();
  });

  it('finds chip when cursor is at container level right before chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    // Set cursor at container level, offset 0 (before chip)
    setCursor(el, 0);
    expect(getAdjacentChip(el, 'after')).not.toBeNull();
  });

  it('finds chip when cursor is at container level right after chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    // Set cursor at container level, offset 1 (after chip)
    setCursor(el, 1);
    expect(getAdjacentChip(el, 'before')).not.toBeNull();
  });
});

// ── handleChipNavigation: Left Arrow ─────────────────────────────────────────

describe('handleChipNavigation — Left Arrow', () => {
  it('moves cursor before chip when cursor is right after chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} world`);
    // Put cursor at start of " world" text node (right after chip)
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0); // Before the chip
  });

  it('returns false when cursor is in middle of text', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(false);
  });

  it('returns false when cursor is at start of input', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(false);
  });

  it('returns false when cursor is after text that follows a chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} world`);
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 3); // middle of " world"

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(false);
  });

  it('moves cursor before chip when at container level after chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    setCursor(el, 1); // container level, after chip

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0);
  });
});

// ── handleChipNavigation: Right Arrow ────────────────────────────────────────

describe('handleChipNavigation — Right Arrow', () => {
  it('moves cursor after chip when cursor is right before chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token}`);
    // Put cursor at end of "hello " text node (right before chip)
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 6);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(6 + token.length); // After chip
  });

  it('returns false when cursor is in middle of text', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(false);
  });

  it('returns false when cursor is at end of input', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(false);
  });

  it('returns false when cursor is before text that precedes a chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token}`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 2); // middle of "hello "

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(false);
  });

  it('moves cursor after chip when at container level before chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    setCursor(el, 0); // container level, before chip

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(token.length);
  });
});

// ── handleChipNavigation: Alt+Left (word skip) ──────────────────────────────

describe('handleChipNavigation — Alt+Left', () => {
  it('jumps before chip when cursor is after chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} world`);
    // Cursor right after chip: start of " world"
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0);
  });

  it('jumps to previous word boundary in text (not past chip)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} hello world`);
    // Cursor at end of "world"
    const textNode = el.childNodes[1]!;
    const text = textNode.textContent ?? '';
    setCursor(textNode, text.length);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    // Should jump to start of "world" = token.length + " hello ".length
    expect(getRawOffset(el)).toBe(token.length + ' hello '.length);
  });

  it('jumps before chip2 when cursor is between chip1 and chip2', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}`);
    // Cursor at container level after chip_b = offset 2
    setCursor(el, 2);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(tokenA.length); // Before chip_b
  });

  it('standard word skip in plain text (no chips)', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 11); // end of "hello world"

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(6); // start of "world"
  });

  it('does nothing at start of input', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(false);
  });
});

// ── handleChipNavigation: Alt+Right (word skip) ─────────────────────────────

describe('handleChipNavigation — Alt+Right', () => {
  it('jumps after chip when cursor is before chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token}`);
    // Cursor at end of "hello " = right before chip
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 6);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(6 + token.length);
  });

  it('jumps to next word boundary in text (standard)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello world ${token}`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    // Should jump past "hello " to position 6
    expect(getRawOffset(el)).toBe(6);
  });

  it('jumps after chip1 when cursor is between chip1 and chip2 at start', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}`);
    // Cursor at container level before chip_a = offset 0
    setCursor(el, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(tokenA.length); // After chip_a
  });

  it('standard word skip in plain text (no chips)', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(6); // after "hello "
  });

  it('does nothing at end of input', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('handleChipNavigation — edge cases', () => {
  it('returns false for empty input', () => {
    const el = makeContainerHtml('');
    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(false);
  });

  it('returns false for non-arrow keys', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 3);
    expect(handleChipNavigation(el, makeKeyEvent('Enter'))).toBe(false);
    expect(handleChipNavigation(el, makeKeyEvent('a'))).toBe(false);
  });

  it('returns false for Shift+Arrow (selection extending)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    setCursor(el, 0);
    expect(handleChipNavigation(el, makeKeyEvent('ArrowRight', { shiftKey: true }))).toBe(false);
  });

  it('returns false for Meta+Arrow (line navigation)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    setCursor(el, 0);
    expect(handleChipNavigation(el, makeKeyEvent('ArrowRight', { metaKey: true }))).toBe(false);
  });

  it('navigates between adjacent chips with single arrow keys', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}`);

    // Start before chip_a
    setCursor(el, 0);

    // Right → after chip_a
    handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(getRawOffset(el)).toBe(tokenA.length);

    // Right → after chip_b
    handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(getRawOffset(el)).toBe(tokenA.length + tokenB.length);

    // Left → before chip_b (after chip_a)
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(tokenA.length);

    // Left → before chip_a
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(0);
  });

  it('chip at start — Left returns false when already before it', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} text`);
    setCursor(el, 0); // Before chip

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handled).toBe(false);
  });

  it('chip at end — Right returns false when already after it', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`text ${token}`);
    // Set cursor after chip (at container level after last child)
    setCursor(el, el.childNodes.length);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(false);
  });

  it('input with only chips (no text) — Left navigates between chips', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const tokenC = fileToken('c.ts');
    const el = makeContainer(`${tokenA}${tokenB}${tokenC}`);

    // Start at end
    setCursor(el, 3);

    // Left → before chip_c
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(tokenA.length + tokenB.length);

    // Left → before chip_b
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(tokenA.length);

    // Left → before chip_a
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(0);
  });
});

// ── findWordBoundary ─────────────────────────────────────────────────────────

describe('findWordBoundary', () => {
  it('finds previous word boundary in plain text', () => {
    const el = makeContainer('hello world');
    // From offset 11 (end) → expect 6 (start of "world")
    expect(findWordBoundary(el, 11, 'left')).toBe(6);
  });

  it('finds next word boundary in plain text', () => {
    const el = makeContainer('hello world');
    // From offset 0 → expect 6 (after "hello ")
    expect(findWordBoundary(el, 0, 'right')).toBe(6);
  });

  it('treats chip as word boundary (left)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);
    // From end of token → expect start of token
    const tokenEnd = 6 + token.length;
    expect(findWordBoundary(el, tokenEnd, 'left')).toBe(6);
  });

  it('treats chip as word boundary (right)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);
    // From "hello " boundary (6) → expect after chip
    expect(findWordBoundary(el, 6, 'right')).toBe(6 + token.length);
  });

  it('returns 0 when already at start (left)', () => {
    const el = makeContainer('hello');
    expect(findWordBoundary(el, 0, 'left')).toBe(0);
  });

  it('returns total length when already at end (right)', () => {
    const el = makeContainer('hello');
    expect(findWordBoundary(el, 5, 'right')).toBe(5);
  });

  // ── Alt+Arrow chip-skip after whitespace ────────────────────────────────────

  it('skips chip after consuming whitespace going left: <chip><space><caret> → <caret><chip><space>', () => {
    const token = fileToken('a.ts');
    // Layout: <chip>" " with caret at the end
    const el = makeContainer(`${token} `);
    const totalLen = token.length + 1;
    expect(findWordBoundary(el, totalLen, 'left')).toBe(0);
  });

  it('skips chip after consuming whitespace going right: <caret><space><chip> → <space><chip><caret>', () => {
    const token = fileToken('a.ts');
    // Layout: " "<chip> with caret at position 0
    const el = makeContainer(` ${token}`);
    expect(findWordBoundary(el, 0, 'right')).toBe(1 + token.length);
  });

  it('stops before chip (not before text) going left: text<chip><space><caret>', () => {
    const token = fileToken('a.ts');
    // Layout: "text"<chip>" " with caret at the end
    const el = makeContainer(`text${token} `);
    const totalLen = 4 + token.length + 1;
    // Should stop before chip (at offset 4), not before "text" (at offset 0)
    expect(findWordBoundary(el, totalLen, 'left')).toBe(4);
  });

  it('stops after chip (not after more) going right: <caret><space><chip>more', () => {
    const token = fileToken('a.ts');
    // Layout: " "<chip>"more" with caret at position 0
    const el = makeContainer(` ${token}more`);
    // Should stop after chip (at offset 1 + token.length), not after "more"
    expect(findWordBoundary(el, 0, 'right')).toBe(1 + token.length);
  });
});
