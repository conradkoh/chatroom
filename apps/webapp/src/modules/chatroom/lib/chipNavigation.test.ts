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

  it('handles Meta+Arrow (Cmd+Arrow line navigation)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 3); // mid-text

    // Cmd+Left should move to position 0
    const handledLeft = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { metaKey: true }));
    expect(handledLeft).toBe(true);
    expect(getRawOffset(el)).toBe(0);

    // Cmd+Right should move to end
    const totalLen = 'hello '.length + token.length + ' world'.length;
    const handledRight = handleChipNavigation(el, makeKeyEvent('ArrowRight', { metaKey: true }));
    expect(handledRight).toBe(true);
    expect(getRawOffset(el)).toBe(totalLen);
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

// ── Hardening edge cases ─────────────────────────────────────────────────────

describe('handleChipNavigation — hardening edge cases', () => {
  // Case 1: Multiple spaces between text and chip
  it('Alt+Left: word<3 spaces><chip><caret> skips chip and all whitespace', () => {
    const token = fileToken('a.ts');
    // Layout: "word   "<chip> with caret at end
    const el = makeContainer(`word   ${token}`);
    // Set cursor at end (after chip)
    setCursor(el, el.childNodes.length);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    // Should land before chip, at position 7 ("word   " boundary)
    // Then another Alt+Left should land at "word" start
    expect(getRawOffset(el)).toBe(7);
  });

  // Case 2: Chip surrounded by only whitespace
  it('Alt+Right: <caret><space><chip><space> jumps past chip', () => {
    const token = fileToken('a.ts');
    // Layout: " "<chip>" " with caret at position 0
    const el = makeContainer(` ${token} `);

    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    // Should skip whitespace + chip, landing after chip at offset 1 + token.length
    expect(getRawOffset(el)).toBe(1 + token.length);
  });

  // Case 3: Tab character as whitespace near chip
  it('Alt+Left: <chip><tab><caret> treats tab as whitespace and skips chip', () => {
    const token = fileToken('a.ts');
    // Layout: <chip>\t with caret at end
    const el = makeContainer(`${token}\t`);
    // Position cursor at end of tab text node
    const textNode = el.childNodes[1]!; // text node "\t"
    setCursor(textNode, 1);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0); // Before the chip
  });

  // Case 4: Alt+Left repeated traversal through mixed content
  it('Alt+Left repeated: word1 <chip1> <chip2> word2<caret> traverses all boundaries', () => {
    const chip1 = fileToken('a.ts');
    const chip2 = fileToken('b.ts');
    // Layout: "word1 "<chip1>" "<chip2>" word2"
    const el = makeContainer(`word1 ${chip1} ${chip2} word2`);
    const chip1End = 6 + chip1.length;
    const chip2Start = chip1End + 1; // " " after chip1
    const chip2End = chip2Start + chip2.length;

    // Start at end
    const lastText = el.childNodes[el.childNodes.length - 1]!;
    setCursor(lastText, (lastText.textContent ?? '').length);

    // Alt+Left 1: jump to start of "word2" within " word2"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip2End + 1); // after " " before "word2"

    // Alt+Left 2: jump before chip2 (skip whitespace " " at start of " word2" then skip chip2)
    // Whitespace consumed but no word chars → continues past chip2, lands at chip2Start
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip2Start); // before chip2

    // Alt+Left 3: now at chip1End (29), which is the start of " " text segment
    // This is at a segment boundary — find word boundary left goes into chip1
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(6); // before chip1, after "word1 "

    // Alt+Left 4: jump to start of "word1"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });

  // Case 5: Alt+Right repeated traversal through mixed content
  it('Alt+Right repeated: <caret>word1 <chip1> <chip2> word2 traverses all boundaries', () => {
    const chip1 = fileToken('a.ts');
    const chip2 = fileToken('b.ts');
    // Layout: "word1 "<chip1>" "<chip2>" word2"
    const el = makeContainer(`word1 ${chip1} ${chip2} word2`);
    const chip1End = 6 + chip1.length;
    const chip2Start = chip1End + 1;
    const chip2End = chip2Start + chip2.length;

    // Start at beginning
    const firstText = el.childNodes[0]!;
    setCursor(firstText, 0);

    // Alt+Right 1: jump past "word1 " (word chars + trailing whitespace)
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(6);

    // Alt+Right 2: at chip1 boundary → skip chip1
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip1End);

    // Alt+Right 3: skip " " (whitespace-only segment) + chip2
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip2End);

    // Alt+Right 4: in " word2", skip the leading space
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip2End + 1); // past space, at start of "word2"

    // Alt+Right 5: skip "word2" to end
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip2End + 6); // end of " word2"
  });

  // Case 6: Adjacent chips with text after — Right arrow at boundary
  it('Right arrow skips chip2 when between <chip1><chip2>text', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}text`);

    // Set cursor at container level between chip1 and chip2 (index 1)
    setCursor(el, 1);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(tokenA.length + tokenB.length); // after chip2, before "text"
  });

  // Case 7: Single character text node between two chips
  it('Left/Right returns false when cursor is inside single-char text between chips', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}x${tokenB}`);

    // Find the "x" text node (should be childNodes[1])
    let textNode: Node | null = null;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent === 'x') {
        textNode = child;
        break;
      }
    }
    expect(textNode).not.toBeNull();

    // Cursor at offset 1 in "x" (end of "x") — chip is after
    setCursor(textNode!, 1);
    const handledRight = handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(handledRight).toBe(true); // Adjacent to chip after

    // Cursor at offset 0 in "x" (start of "x") — chip is before
    setCursor(textNode!, 0);
    const handledLeft = handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(handledLeft).toBe(true); // Adjacent to chip before
  });

  // Case 8: Chip at start, Alt+Left from inside adjacent text word
  it('Alt+Left from <chip>word<caret> jumps to start of "word", not past chip', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token}word`);

    // Set cursor at end of "word"
    const textNode = el.childNodes[1]!; // "word" text node
    setCursor(textNode, 4);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    // Should jump to start of "word" (after chip), not before chip
    expect(getRawOffset(el)).toBe(token.length);
  });

  // Case 9: Only whitespace in the input (no chips)
  it('Alt+Right in whitespace-only input jumps to end', () => {
    const el = makeContainer('   ');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(3);
  });

  it('Alt+Left in whitespace-only input jumps to start', () => {
    const el = makeContainer('   ');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 3);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0);
  });

  // Case 10: Three adjacent chips with Alt+Left from end
  it('Alt+Left through 3 adjacent chips skips one at a time', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const tokenC = fileToken('c.ts');
    const el = makeContainer(`${tokenA}${tokenB}${tokenC}`);

    // Start at end (after chip_c)
    setCursor(el, 3);

    // Alt+Left 1: before chip_c
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(tokenA.length + tokenB.length);

    // Alt+Left 2: before chip_b
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(tokenA.length);

    // Alt+Left 3: before chip_a
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });
});

// ── Hardening edge cases: Round 2 ───────────────────────────────────────────

describe('handleChipNavigation — hardening edge cases: round 2', () => {
  // Case 1: Punctuation as word boundary near chip
  // Punctuation chars are \S (non-whitespace) so they're treated as word chars by the algorithm.
  // Tests that "word." before a chip behaves correctly — Alt+Left should stop at the right boundary.
  it('Alt+Left: word.<chip><caret> — punctuation treated as word chars', () => {
    const token = fileToken('a.ts');
    // Layout: "word."<chip> — caret after chip
    const el = makeContainer(`word.${token}`);
    setCursor(el, el.childNodes.length);

    // Alt+Left should jump before chip (since chip is atomic word)
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(5); // before chip, after "word."

    // Alt+Left again should jump to start of "word." (all non-whitespace)
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });

  // Case 2: Mixed punctuation and spaces before chip
  // "hello! " has a word boundary between "!" and " ", then whitespace before chip
  it('Alt+Left: hello! <chip><caret> — stops before chip, then before hello!', () => {
    const token = fileToken('a.ts');
    // Layout: "hello! "<chip> — caret after chip
    const el = makeContainer(`hello! ${token}`);
    setCursor(el, el.childNodes.length);

    // Alt+Left 1: skip chip (atomic)
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(7); // before chip, after "hello! "

    // Alt+Left 2: whitespace-only before segment boundary → skip past whitespace
    // findWordBoundaryLeft from offset 7 (end of "hello! "): skip " " → "!" → "hello!" is all \S
    // Actually: skip whitespace " " (pos 6→7), then skip non-whitespace "hello!" → lands at 0
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });

  // Case 3: Alt+Right from middle of a word that precedes a chip
  // Should jump to end of word + trailing space, not skip the chip
  it('Alt+Right from mid-word before chip: hel|lo <chip> — stops after "lo ", not after chip', () => {
    const token = fileToken('a.ts');
    // Layout: "hello "<chip>
    const el = makeContainer(`hello ${token}`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 3); // hel|lo

    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(6); // after "hello " (word + trailing whitespace)
  });

  // Case 4: Alt+Left from middle of a word that follows a chip
  // Should jump to start of word, not skip the chip
  it('Alt+Left from mid-word after chip: <chip>hel|lo — stops at start of "hello", not before chip', () => {
    const token = fileToken('a.ts');
    // Layout: <chip>"hello"
    const el = makeContainer(`${token}hello`);
    const textNode = el.childNodes[1]!; // "hello" text node
    setCursor(textNode, 3); // hel|lo

    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    // Should stop at start of "hello" (offset = token.length), not skip the chip
    expect(getRawOffset(el)).toBe(token.length);
  });

  // Case 5: Ping-pong — alternating left/right around a single chip
  // Verifies cursor position stability after repeated direction changes
  it('ping-pong: alternating Left/Right around single chip stays stable', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);

    // Position cursor right before chip (end of "hello ")
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 6);

    // Right → skip chip → after chip
    handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(getRawOffset(el)).toBe(6 + token.length);

    // Left → skip chip back → before chip
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(6);

    // Right → skip chip again → after chip
    handleChipNavigation(el, makeKeyEvent('ArrowRight'));
    expect(getRawOffset(el)).toBe(6 + token.length);

    // Left → back to before chip
    handleChipNavigation(el, makeKeyEvent('ArrowLeft'));
    expect(getRawOffset(el)).toBe(6);
  });

  // Case 6: Long text with multiple words before chip
  // Alt+Left from after chip should skip chip, not jump into the multi-word text
  it('Alt+Left: the quick brown fox <chip><caret> — skips chip, lands after "fox "', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`the quick brown fox ${token}`);
    setCursor(el, el.childNodes.length);

    // Alt+Left 1: skip chip
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(20); // before chip, after "the quick brown fox "

    // Alt+Left 2: jump to start of "fox"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(16); // start of "fox "

    // Alt+Left 3: jump to start of "brown"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(10); // start of "brown"
  });

  // Case 7: Chip between two words with no spaces (direct adjacency)
  // Tests behavior when chip is "glued" to words on both sides
  it('Alt+Left/Right: word1<chip>word2 — word boundaries respect chip as separator', () => {
    const token = fileToken('a.ts');
    // Layout: "word1"<chip>"word2"
    const el = makeContainer(`word1${token}word2`);

    // Alt+Right from start: skip "word1" (non-whitespace), but there's no trailing whitespace
    // so it should stop at end of "word1" = offset 5, which is right before chip
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(5); // end of "word1", before chip

    // Alt+Right again: at chip boundary → skip chip
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(5 + token.length); // after chip, before "word2"

    // Alt+Right again: skip "word2"
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(5 + token.length + 5); // end

    // Now reverse: Alt+Left from end
    const lastText = el.childNodes[el.childNodes.length - 1]!;
    setCursor(lastText, (lastText.textContent ?? '').length);

    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(5 + token.length); // start of "word2"

    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(5); // before chip

    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0); // start of "word1"
  });

  // Case 8: Multiple chips separated by single spaces — Alt+Right full traversal
  it('Alt+Right: <caret><chip1> <chip2> <chip3> — traverses each chip+space pair', () => {
    const chip1 = fileToken('a.ts');
    const chip2 = fileToken('b.ts');
    const chip3 = fileToken('c.ts');
    // Layout: <chip1>" "<chip2>" "<chip3>
    const el = makeContainer(`${chip1} ${chip2} ${chip3}`);

    setCursor(el, 0);

    // Alt+Right 1: skip chip1
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip1.length);

    // Alt+Right 2: skip " " (whitespace) + chip2
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip1.length + 1 + chip2.length);

    // Alt+Right 3: skip " " (whitespace) + chip3
    handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
    expect(getRawOffset(el)).toBe(chip1.length + 1 + chip2.length + 1 + chip3.length);
  });

  // Case 9: Single chip with text on both sides — repeated Alt+Left from end
  it('Alt+Left repeated: hello <chip> world — full left traversal', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);

    // Start at end of "world"
    const lastText = el.childNodes[el.childNodes.length - 1]!;
    setCursor(lastText, (lastText.textContent ?? '').length);

    // Alt+Left 1: jump to start of "world" within " world"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(6 + token.length + 1); // skip back over "world", land after " "

    // Alt+Left 2: at " " before "world" — whitespace-only → skip chip too
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(6); // before chip

    // Alt+Left 3: skip whitespace " " at end of "hello " then skip "hello"
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });

  // Case 10: Emoji/unicode in text adjacent to chip
  // Emoji are multi-byte but single "characters" in JS string terms (may be 2 code units).
  // Tests that word boundary detection handles non-ASCII non-whitespace correctly.
  it('Alt+Left: 👋hello <chip><caret> — treats emoji as part of word', () => {
    const token = fileToken('a.ts');
    // "👋hello " is the text before chip — emoji is \S so included in word
    const el = makeContainer(`👋hello ${token}`);
    setCursor(el, el.childNodes.length);

    // Alt+Left 1: skip chip
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    const emojiWord = '👋hello ';
    expect(getRawOffset(el)).toBe(emojiWord.length); // before chip

    // Alt+Left 2: skip back over "👋hello " — all \S chars then whitespace
    handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(getRawOffset(el)).toBe(0);
  });
});

// ── Cmd+Left/Right (line start/end) ─────────────────────────────────────────

describe('handleChipNavigation — Cmd+Left/Right (line start/end)', () => {
  it('Cmd+Left with chip at line start → caret moves to position 0 (before chip)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} world`);
    // Cursor in the middle of " world"
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 3);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0); // Before the chip
  });

  it('Cmd+Left with text then chip at start → caret moves to position 0', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);
    // Cursor at end of " world"
    const lastText = el.childNodes[el.childNodes.length - 1]!;
    setCursor(lastText, (lastText.textContent ?? '').length);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0);
  });

  it('Cmd+Right with chip at line end → caret moves to end of content', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token}`);
    // Cursor at beginning
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const totalLen = 6 + token.length;
    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(totalLen);
  });

  it('Cmd+Right with chip then text at end → caret moves to end of content', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} hello world`);
    // Cursor at beginning (before chip)
    setCursor(el, 0);

    const totalLen = token.length + ' hello world'.length;
    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(totalLen);
  });

  it('Cmd+Left already at position 0 → still returns true (handled)', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 0);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(0);
  });

  it('Cmd+Right already at end → still returns true (handled)', () => {
    const el = makeContainer('hello');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowRight', { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(5);
  });

  it('Shift+Cmd+Arrow still falls through to browser (not handled)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`${token} world`);
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 3);

    // Shift+Cmd+Left should NOT be handled (browser does selection)
    const handled = handleChipNavigation(
      el,
      makeKeyEvent('ArrowLeft', { metaKey: true, shiftKey: true })
    );
    expect(handled).toBe(false);
  });
});

// ── Combinatoric test matrix ─────────────────────────────────────────────────

describe('handleChipNavigation — combinatoric matrix', () => {
  // ── Constants ──────────────────────────────────────────────────────────────
  const CHIP_A = fileToken('a.ts'); // {file://workspace/a.ts} = 23 chars
  const CHIP_B = fileToken('b.ts'); // {file://workspace/b.ts} = 23 chars
  const CHIP_A_LEN = CHIP_A.length; // 23
  const CHIP_B_LEN = CHIP_B.length; // 23

  // ── Layout definitions ────────────────────────────────────────────────────
  interface Layout {
    name: string;
    raw: string;
    totalLen: number;
    /** Named cursor positions for this layout */
    positions: Record<string, number>;
  }

  const layouts: Layout[] = [
    {
      name: 'chipOnly',
      raw: CHIP_A,
      totalLen: CHIP_A_LEN,
      positions: {
        start: 0,
        afterChipA: CHIP_A_LEN,
      },
    },
    {
      name: 'textChip',
      raw: `hello ${CHIP_A}`,
      totalLen: 6 + CHIP_A_LEN, // 29
      positions: {
        start: 0,
        midText: 3, // hel|lo
        beforeChipA: 6, // end of "hello "
        end: 6 + CHIP_A_LEN,
      },
    },
    {
      name: 'chipText',
      raw: `${CHIP_A} world`,
      totalLen: CHIP_A_LEN + 6, // 29
      positions: {
        start: 0,
        afterChipA: CHIP_A_LEN, // start of " world"
        midText: CHIP_A_LEN + 3, // " wo|rld"
        end: CHIP_A_LEN + 6,
      },
    },
    {
      name: 'textChipText',
      raw: `hello ${CHIP_A} world`,
      totalLen: 6 + CHIP_A_LEN + 6, // 35
      positions: {
        start: 0,
        midTextBefore: 3, // hel|lo
        beforeChipA: 6,
        afterChipA: 6 + CHIP_A_LEN, // 29
        midTextAfter: 6 + CHIP_A_LEN + 3, // 32, " wo|rld"
        end: 6 + CHIP_A_LEN + 6, // 35
      },
    },
    {
      name: 'chipChip',
      raw: `${CHIP_A}${CHIP_B}`,
      totalLen: CHIP_A_LEN + CHIP_B_LEN, // 46
      positions: {
        start: 0,
        betweenChips: CHIP_A_LEN, // 23
        end: CHIP_A_LEN + CHIP_B_LEN, // 46
      },
    },
    {
      name: 'chipTextChip',
      raw: `${CHIP_A} mid ${CHIP_B}`,
      totalLen: CHIP_A_LEN + 5 + CHIP_B_LEN, // 51 (" mid " = 5)
      positions: {
        start: 0,
        afterChipA: CHIP_A_LEN, // 23
        midText: CHIP_A_LEN + 2, // 25, " m|id "
        beforeChipB: CHIP_A_LEN + 5, // 28
        end: CHIP_A_LEN + 5 + CHIP_B_LEN, // 51
      },
    },
  ];

  // ── Hotkey definitions ────────────────────────────────────────────────────
  type Hotkey = 'Arrow' | 'Shift+Arrow' | 'Alt+Arrow' | 'Cmd+Arrow' | 'Shift+Cmd+Arrow';

  interface HotkeyDef {
    name: Hotkey;
    makeEvent: (dir: 'ArrowLeft' | 'ArrowRight') => KeyboardEvent;
  }

  const hotkeys: HotkeyDef[] = [
    { name: 'Arrow', makeEvent: (dir) => makeKeyEvent(dir) },
    { name: 'Shift+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { shiftKey: true }) },
    { name: 'Alt+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { altKey: true }) },
    { name: 'Cmd+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { metaKey: true }) },
    {
      name: 'Shift+Cmd+Arrow',
      makeEvent: (dir) => makeKeyEvent(dir, { metaKey: true, shiftKey: true }),
    },
  ];

  // ── Test case type ────────────────────────────────────────────────────────
  interface MatrixCase {
    layout: string;
    hotkey: Hotkey;
    direction: 'Left' | 'Right';
    positionName: string;
    startOffset: number;
    expectedHandled: boolean;
    expectedOffset?: number; // only when handled=true
  }

  // ── Helper: is cursor adjacent to chip in a given direction ────────────
  // Determines whether a plain Arrow key would be handled at a given position
  function isAdjacentToChip(
    layout: Layout,
    offset: number,
    direction: 'Left' | 'Right'
  ): { handled: boolean; targetOffset?: number } {
    // Parse the raw string to find chip positions
    const chipPositions = findChipPositions(layout.raw);

    if (direction === 'Left') {
      // Check if there's a chip that ends at this offset
      for (const cp of chipPositions) {
        if (cp.end === offset) {
          return { handled: true, targetOffset: cp.start };
        }
      }
    } else {
      // Check if there's a chip that starts at this offset
      for (const cp of chipPositions) {
        if (cp.start === offset) {
          return { handled: true, targetOffset: cp.end };
        }
      }
    }
    return { handled: false };
  }

  interface ChipPosition {
    start: number;
    end: number;
    token: string;
  }

  function findChipPositions(raw: string): ChipPosition[] {
    const chips: ChipPosition[] = [];
    const regex = /\{file:\/\/workspace\/[^}]+\}/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      chips.push({ start: match.index, end: match.index + match[0].length, token: match[0] });
    }
    return chips;
  }

  // ── Helper: compute Alt+Arrow expected outcome ─────────────────────────
  // This mirrors the findWordBoundary logic to determine expected positions
  function computeAltArrowExpected(
    layout: Layout,
    offset: number,
    direction: 'Left' | 'Right'
  ): { handled: boolean; targetOffset?: number } {
    // At boundaries, Alt+Arrow returns false (no movement)
    if (direction === 'Left' && offset === 0) return { handled: false };
    if (direction === 'Right' && offset === layout.totalLen) return { handled: false };

    // Build a simplified segment model to compute expected word boundary
    const segments = buildTestSegments(layout.raw);
    let target: number;
    if (direction === 'Left') {
      target = computeWordBoundaryLeft(segments, offset);
    } else {
      target = computeWordBoundaryRight(segments, offset, layout.totalLen);
    }

    if (target === offset) return { handled: false };
    return { handled: true, targetOffset: target };
  }

  interface TestSegment {
    type: 'text' | 'chip';
    content: string;
    start: number;
    end: number;
  }

  function buildTestSegments(raw: string): TestSegment[] {
    const segments: TestSegment[] = [];
    const chipRegex = /\{file:\/\/workspace\/[^}]+\}/g;
    let lastIndex = 0;
    let match;

    while ((match = chipRegex.exec(raw)) !== null) {
      if (match.index > lastIndex) {
        const text = raw.substring(lastIndex, match.index);
        segments.push({ type: 'text', content: text, start: lastIndex, end: match.index });
      }
      segments.push({
        type: 'chip',
        content: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < raw.length) {
      segments.push({
        type: 'text',
        content: raw.substring(lastIndex),
        start: lastIndex,
        end: raw.length,
      });
    }
    return segments;
  }

  function computeWordBoundaryLeft(segments: TestSegment[], fromOffset: number): number {
    let pos = fromOffset;

    // Inside a segment
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i]!;
      if (pos > seg.end || pos <= seg.start) continue;

      if (seg.type === 'chip') return seg.start;

      const offsetInText = pos - seg.start;
      const newOffset = textWordBoundaryLeft(seg.content, offsetInText);
      if (newOffset < offsetInText) {
        const onlyWhitespace =
          newOffset === 0 && /^\s+$/.test(seg.content.substring(0, offsetInText));
        if (!onlyWhitespace) return seg.start + newOffset;
      }
      pos = seg.start;
    }

    // At segment boundary
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i]!;
      if (seg.end !== pos) continue;

      if (seg.type === 'chip') return seg.start;

      const newOffset = textWordBoundaryLeft(seg.content, seg.content.length);
      if (newOffset < seg.content.length) {
        const onlyWhitespace = newOffset === 0 && /^\s+$/.test(seg.content);
        if (!onlyWhitespace) return seg.start + newOffset;
      }
      pos = seg.start;

      for (let j = i - 1; j >= 0; j--) {
        const prevSeg = segments[j]!;
        if (prevSeg.end !== pos) continue;
        if (prevSeg.type === 'chip') return prevSeg.start;
        const prevOffset = textWordBoundaryLeft(prevSeg.content, prevSeg.content.length);
        if (prevOffset < prevSeg.content.length) {
          const prevOnlyWs = prevOffset === 0 && /^\s+$/.test(prevSeg.content);
          if (!prevOnlyWs) return prevSeg.start + prevOffset;
        }
        pos = prevSeg.start;
      }
      break;
    }

    return 0;
  }

  function computeWordBoundaryRight(
    segments: TestSegment[],
    fromOffset: number,
    totalLen: number
  ): number {
    let pos = fromOffset;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (pos < seg.start || pos >= seg.end) continue;

      if (seg.type === 'chip') return seg.end;

      const offsetInText = pos - seg.start;
      const newOffset = textWordBoundaryRight(seg.content, offsetInText);
      if (newOffset > offsetInText) {
        const onlyWhitespace =
          newOffset === seg.content.length &&
          /^\s+$/.test(seg.content.substring(offsetInText, newOffset));
        if (!onlyWhitespace) return seg.start + newOffset;
      }
      pos = seg.end;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.start !== pos) continue;

      if (seg.type === 'chip') return seg.end;

      const newOffset = textWordBoundaryRight(seg.content, 0);
      if (newOffset > 0) {
        const onlyWhitespace = newOffset === seg.content.length && /^\s+$/.test(seg.content);
        if (!onlyWhitespace) return seg.start + newOffset;
      }
      pos = seg.end;

      for (let j = i + 1; j < segments.length; j++) {
        const nextSeg = segments[j]!;
        if (nextSeg.start !== pos) continue;
        if (nextSeg.type === 'chip') return nextSeg.end;
        const nextOffset = textWordBoundaryRight(nextSeg.content, 0);
        if (nextOffset > 0) {
          const nextOnlyWs = nextOffset === nextSeg.content.length && /^\s+$/.test(nextSeg.content);
          if (!nextOnlyWs) return nextSeg.start + nextOffset;
        }
        pos = nextSeg.end;
      }
      break;
    }

    return totalLen;
  }

  function textWordBoundaryLeft(text: string, offset: number): number {
    let p = offset;
    while (p > 0 && /\s/.test(text[p - 1]!)) p--;
    while (p > 0 && /\S/.test(text[p - 1]!)) p--;
    return p;
  }

  function textWordBoundaryRight(text: string, offset: number): number {
    let p = offset;
    while (p < text.length && /\S/.test(text[p]!)) p++;
    while (p < text.length && /\s/.test(text[p]!)) p++;
    return p;
  }

  // ── Generate test cases ───────────────────────────────────────────────────
  const cases: MatrixCase[] = [];

  for (const layout of layouts) {
    for (const posName of Object.keys(layout.positions)) {
      const startOffset = layout.positions[posName]!;
      for (const hotkey of hotkeys) {
        for (const direction of ['Left', 'Right'] as const) {
          let expectedHandled: boolean;
          let expectedOffset: number | undefined;

          if (hotkey.name === 'Shift+Arrow' || hotkey.name === 'Shift+Cmd+Arrow') {
            // Always falls through to browser
            expectedHandled = false;
          } else if (hotkey.name === 'Cmd+Arrow') {
            // Always handled: jump to start or end
            expectedHandled = true;
            expectedOffset = direction === 'Left' ? 0 : layout.totalLen;
          } else if (hotkey.name === 'Arrow') {
            const result = isAdjacentToChip(layout, startOffset, direction);
            expectedHandled = result.handled;
            expectedOffset = result.targetOffset;
          } else {
            // Alt+Arrow
            const result = computeAltArrowExpected(layout, startOffset, direction);
            expectedHandled = result.handled;
            expectedOffset = result.targetOffset;
          }

          cases.push({
            layout: layout.name,
            hotkey: hotkey.name,
            direction,
            positionName: posName,
            startOffset,
            expectedHandled,
            expectedOffset,
          });
        }
      }
    }
  }

  // ── Run matrix ────────────────────────────────────────────────────────────
  // Group by layout for readability
  for (const layout of layouts) {
    describe(`layout: ${layout.name} — "${layout.raw.replace(/\{file:\/\/workspace\/([^}]+)\}/g, '[$1]')}"`, () => {
      const layoutCases = cases.filter((c) => c.layout === layout.name);

      it.each(layoutCases)(
        '$hotkey $direction @ $positionName (offset $startOffset) → handled=$expectedHandled',
        (tc) => {
          const el = makeContainer(layout.raw);
          setCursorToOffset(el, tc.startOffset);

          const hotkeyDef = hotkeys.find((h) => h.name === tc.hotkey)!;
          const arrowKey = tc.direction === 'Left' ? 'ArrowLeft' : 'ArrowRight';
          const event = hotkeyDef.makeEvent(arrowKey);

          const handled = handleChipNavigation(el, event);
          expect(handled).toBe(tc.expectedHandled);

          if (tc.expectedHandled && tc.expectedOffset !== undefined) {
            expect(getRawOffset(el)).toBe(tc.expectedOffset);
          }
        }
      );
    });
  }

  // ── Helper: set cursor to a raw offset ────────────────────────────────────
  // Walks the DOM tree to position cursor at the correct raw offset
  function setCursorToOffset(container: HTMLElement, targetOffset: number): void {
    if (targetOffset === 0 && container.childNodes.length > 0) {
      // Position at start: if first child is text, use it; otherwise use container level
      const first = container.childNodes[0]!;
      if (first.nodeType === Node.TEXT_NODE) {
        setCursor(first, 0);
      } else {
        setCursor(container, 0);
      }
      return;
    }

    let remaining = targetOffset;

    for (let i = 0; i < container.childNodes.length; i++) {
      const node = container.childNodes[i]!;

      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent ?? '').length;
        if (remaining <= len) {
          setCursor(node, remaining);
          return;
        }
        remaining -= len;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const fileRef = el.getAttribute('data-file-ref');
        if (fileRef) {
          if (remaining === 0) {
            // Before chip
            setCursor(container, i);
            return;
          }
          if (remaining <= fileRef.length) {
            // After chip
            setCursor(container, i + 1);
            remaining = 0;
            // Check if there's more content or we should stop here
            if (remaining === 0) return;
          }
          remaining -= fileRef.length;
        } else {
          const innerLen = (el.textContent ?? '').length;
          if (remaining <= innerLen) {
            // Recurse into inner text
            setCursor(node, remaining);
            return;
          }
          remaining -= innerLen;
        }
      }
    }

    // If we've exhausted all nodes, position at end of container
    setCursor(container, container.childNodes.length);
  }
});
