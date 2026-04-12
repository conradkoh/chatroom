import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rawTextToHtml, stripZws } from '@/lib/fileReferenceSerializer';
import {
  handleChipNavigation,
  handleChipClick,
  sanitizeCursorPosition,
  isChipNode,
  getAdjacentChip,
  findWordBoundary,
} from './chipNavigation';

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
        const text = node.textContent ?? '';
        const beforeCursor = text.slice(0, cursor!.offset);
        offset += stripZws(beforeCursor).length;
      } else {
        for (let i = 0; i < cursor!.offset && i < node.childNodes.length; i++) {
          accumulateLength(node.childNodes[i]!);
        }
      }
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += stripZws(node.textContent ?? '').length;
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
      offset += stripZws(node.textContent ?? '').length;
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

/**
 * Find the text node within a container whose stripped content matches,
 * or that contains the given substring. Useful for locating text nodes
 * after ZWS insertion shifts child indices.
 */
function findTextNode(container: HTMLElement, content: string): Node {
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const stripped = stripZws(node.textContent ?? '');
      if (stripped === content || stripped.includes(content)) return node;
    }
  }
  throw new Error(`Text node containing "${content}" not found`);
}

/**
 * Map a raw text offset (ZWS-free) to a DOM offset within a text node
 * that may contain ZWS characters.
 */
function rawToDomOffsetHelper(text: string, rawOffset: number): number {
  let rawCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\u200B') continue;
    if (rawCount === rawOffset) return i;
    rawCount++;
  }
  return text.length;
}

/**
 * Check if a node is a ZWS-only text node.
 */
function isZwsNode(node: Node): boolean {
  return (
    node.nodeType === Node.TEXT_NODE &&
    node.textContent !== null &&
    node.textContent.length > 0 &&
    stripZws(node.textContent).length === 0
  );
}

/**
 * Set cursor at the container level, adjusting for ZWS text nodes.
 * logicalOffset is relative to "meaningful" children (non-ZWS).
 * A leading ZWS text node is skipped in the count.
 *
 * For logicalOffset 0 with a leading ZWS node, the cursor is placed
 * at the end of the ZWS text node (so adjacent-chip detection works).
 */
function setCursorLogical(container: HTMLElement, logicalOffset: number): void {
  const firstChild = container.childNodes[0];
  const hasLeadingZws = firstChild && isZwsNode(firstChild);

  if (hasLeadingZws) {
    if (logicalOffset === 0) {
      // Place cursor at end of ZWS text node so next sibling = chip
      setCursor(firstChild, firstChild.textContent!.length);
    } else {
      // Shift by 1 to account for ZWS text node
      setCursor(container, logicalOffset + 1);
    }
  } else {
    setCursor(container, logicalOffset);
  }
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

/**
 * Compute the raw offset of an arbitrary DOM position (node, offset) in a container.
 * Mirrors getRawOffset but for any DOM position, not just the current cursor.
 */
function computeRawOffsetAt(
  container: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number {
  let offset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        const beforeCursor = text.slice(0, targetOffset);
        offset += stripZws(beforeCursor).length;
      } else {
        for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) {
          accumulateLength(node.childNodes[i]!);
        }
      }
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += stripZws(node.textContent ?? '').length;
      return false;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        if (el.contains(targetNode)) {
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
      offset += stripZws(node.textContent ?? '').length;
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

/** Get selection as { anchor, focus } in raw offset terms. */
function getSelectionRawOffsets(container: HTMLElement): { anchor: number; focus: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (!selection.anchorNode || !selection.focusNode) return null;

  const anchor = computeRawOffsetAt(container, selection.anchorNode, selection.anchorOffset);
  const focus = computeRawOffsetAt(container, selection.focusNode, selection.focusOffset);
  return { anchor, focus };
}

/**
 * Set cursor to a raw offset within a container by walking the DOM tree.
 * Handles text nodes, chip elements (data-file-ref), and ZWS characters.
 */
function setCursorToOffset(container: HTMLElement, targetOffset: number): void {
  if (targetOffset === 0 && container.childNodes.length > 0) {
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
      const text = node.textContent ?? '';
      const rawLen = stripZws(text).length;
      if (remaining <= rawLen) {
        setCursor(node, rawToDomOffsetHelper(text, remaining));
        return;
      }
      remaining -= rawLen;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        if (remaining === 0) {
          setCursor(container, i);
          return;
        }
        if (remaining <= fileRef.length) {
          setCursor(container, i + 1);
          remaining = 0;
          if (remaining === 0) return;
        }
        remaining -= fileRef.length;
      } else {
        const innerLen = stripZws(el.textContent ?? '').length;
        if (remaining <= innerLen) {
          setCursor(node, rawToDomOffsetHelper(el.textContent ?? '', remaining));
          return;
        }
        remaining -= innerLen;
      }
    }
  }

  setCursor(container, container.childNodes.length);
}

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

describe('getAdjacentChip', () => {
  it.each([
    {
      desc: 'finds chip after cursor at end of preceding text',
      raw: `hello ${fileToken('a.ts')}`,
      dir: 'after' as const,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      expected: 'found',
    },
    {
      desc: 'finds chip before cursor at start of following text',
      raw: `${fileToken('a.ts')} hello`,
      dir: 'before' as const,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' hello'), 0),
      expected: 'found',
    },
    {
      desc: 'returns null when no chip before',
      raw: 'hello world',
      dir: 'before' as const,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expected: 'null',
    },
    {
      desc: 'returns null when no chip after',
      raw: 'hello world',
      dir: 'after' as const,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expected: 'null',
    },
    {
      desc: 'finds chip at container level before chip',
      raw: fileToken('a.ts'),
      dir: 'after' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, 1),
      expected: 'found',
    },
    {
      desc: 'finds chip at container level after chip',
      raw: fileToken('a.ts'),
      dir: 'before' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, 2),
      expected: 'found',
    },
  ])('$desc', ({ raw, dir, setupCursor, expected }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    const result = getAdjacentChip(el, dir);
    if (expected === 'found') expect(result).not.toBeNull();
    else expect(result).toBeNull();
  });
});

describe('handleChipNavigation — Arrow Left/Right', () => {
  it.each([
    {
      dir: 'Left' as const,
      desc: 'moves cursor before chip when cursor is right after chip',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 0),
      expectedHandled: true,
      expectedOffset: 0,
    },
    {
      dir: 'Right' as const,
      desc: 'moves cursor after chip when cursor is right before chip',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      expectedHandled: true,
      expectedOffset: 6 + fileToken('a.ts').length,
    },
    {
      dir: 'Left' as const,
      desc: 'returns false when cursor is in middle of text',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedHandled: false,
    },
    {
      dir: 'Right' as const,
      desc: 'returns false when cursor is in middle of text',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedHandled: false,
    },
    {
      dir: 'Left' as const,
      desc: 'returns false when cursor is at start of input',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedHandled: false,
    },
    {
      dir: 'Right' as const,
      desc: 'returns false when cursor is at end of input',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedHandled: false,
    },
    {
      dir: 'Left' as const,
      desc: 'returns false when cursor is after text that follows a chip',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 3),
      expectedHandled: false,
    },
    {
      dir: 'Right' as const,
      desc: 'returns false when cursor is before text that precedes a chip',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 2),
      expectedHandled: false,
    },
    {
      dir: 'Left' as const,
      desc: 'moves cursor before chip when at container level after chip',
      raw: fileToken('a.ts'),
      setupCursor: (el: HTMLElement) => setCursor(el, 2),
      expectedHandled: true,
      expectedOffset: 0,
    },
    {
      dir: 'Right' as const,
      desc: 'moves cursor after chip when at container level before chip',
      raw: fileToken('a.ts'),
      setupCursor: (el: HTMLElement) => setCursor(el, 1),
      expectedHandled: true,
      expectedOffset: fileToken('a.ts').length,
    },
  ])('Arrow$dir: $desc', ({ dir, raw, setupCursor, expectedHandled, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`));
    expect(handled).toBe(expectedHandled);
    if (expectedHandled && expectedOffset !== undefined) {
      expect(getRawOffset(el)).toBe(expectedOffset);
    }
  });
});

describe('handleChipNavigation — Alt+Left/Right (word skip)', () => {
  it.each([
    {
      dir: 'Left' as const,
      desc: 'jumps before chip when cursor is after chip',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 0),
      expectedHandled: true,
      expectedOffset: 0,
    },
    {
      dir: 'Right' as const,
      desc: 'jumps after chip when cursor is before chip',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      expectedHandled: true,
      expectedOffset: 6 + fileToken('a.ts').length,
    },
    {
      dir: 'Left' as const,
      desc: 'jumps to previous word boundary in text (not past chip)',
      raw: `${fileToken('a.ts')} hello world`,
      setupCursor: (el: HTMLElement) => {
        const textNode = findTextNode(el, ' hello world');
        setCursor(textNode, (textNode.textContent ?? '').length);
      },
      expectedHandled: true,
      expectedOffset: fileToken('a.ts').length + ' hello '.length,
    },
    {
      dir: 'Right' as const,
      desc: 'jumps to next word boundary in text (standard)',
      raw: `hello world ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedHandled: true,
      expectedOffset: 6,
    },
    {
      dir: 'Left' as const,
      desc: 'jumps before chip2 when cursor is between chip1 and chip2',
      raw: `${fileToken('a.ts')}${fileToken('b.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el, 3),
      expectedHandled: true,
      expectedOffset: fileToken('a.ts').length,
    },
    {
      dir: 'Right' as const,
      desc: 'jumps after chip1 when cursor is between chip1 and chip2 at start',
      raw: `${fileToken('a.ts')}${fileToken('b.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el, 0),
      expectedHandled: true,
      expectedOffset: fileToken('a.ts').length,
    },
    {
      dir: 'Left' as const,
      desc: 'standard word skip in plain text (no chips)',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 11),
      expectedHandled: true,
      expectedOffset: 6,
    },
    {
      dir: 'Right' as const,
      desc: 'standard word skip in plain text (no chips)',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedHandled: true,
      expectedOffset: 6,
    },
    {
      dir: 'Left' as const,
      desc: 'does nothing at start of input',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedHandled: false,
    },
    {
      dir: 'Right' as const,
      desc: 'does nothing at end of input',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedHandled: false,
    },
  ])('Alt+Arrow$dir: $desc', ({ dir, raw, setupCursor, expectedHandled, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
    expect(handled).toBe(expectedHandled);
    if (expectedHandled && expectedOffset !== undefined) {
      expect(getRawOffset(el)).toBe(expectedOffset);
    }
  });
});

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
  it('handles Shift+Arrow across chip (selection extending)', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(token);
    setCursorLogical(el, 0); // before chip (after ZWS)
    // Shift+ArrowRight adjacent to chip is now handled (extends selection over chip)
    expect(handleChipNavigation(el, makeKeyEvent('ArrowRight', { shiftKey: true }))).toBe(true);
  });
  it('navigates between adjacent chips with single arrow keys', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}`);
    // Start before chip_a
    setCursorLogical(el, 0);
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
  it.each([
    {
      desc: 'chip at start — Left returns false when already before it',
      raw: `${fileToken('a.ts')} text`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursorLogical(el, 0),
    },
    {
      desc: 'chip at end — Right returns false when already after it',
      raw: `text ${fileToken('a.ts')}`,
      dir: 'Right' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, el.childNodes.length),
    },
  ])('$desc', ({ raw, dir, setupCursor }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    expect(handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`))).toBe(false);
  });
});

describe('findWordBoundary', () => {
  it.each([
    {
      desc: 'previous word boundary in plain text',
      raw: 'hello world',
      offset: 11,
      dir: 'left' as const,
      expected: 6,
    },
    {
      desc: 'next word boundary in plain text',
      raw: 'hello world',
      offset: 0,
      dir: 'right' as const,
      expected: 6,
    },
    {
      desc: 'chip as word boundary (left)',
      raw: `hello ${fileToken('a.ts')} world`,
      offset: 6 + fileToken('a.ts').length,
      dir: 'left' as const,
      expected: 6,
    },
    {
      desc: 'chip as word boundary (right)',
      raw: `hello ${fileToken('a.ts')} world`,
      offset: 6,
      dir: 'right' as const,
      expected: 6 + fileToken('a.ts').length,
    },
    {
      desc: 'returns 0 at start (left)',
      raw: 'hello',
      offset: 0,
      dir: 'left' as const,
      expected: 0,
    },
    {
      desc: 'returns total length at end (right)',
      raw: 'hello',
      offset: 5,
      dir: 'right' as const,
      expected: 5,
    },
    {
      desc: 'skips chip after whitespace (left): <chip><space><caret>',
      raw: `${fileToken('a.ts')} `,
      offset: fileToken('a.ts').length + 1,
      dir: 'left' as const,
      expected: 0,
    },
    {
      desc: 'skips chip after whitespace (right): <caret><space><chip>',
      raw: ` ${fileToken('a.ts')}`,
      offset: 0,
      dir: 'right' as const,
      expected: 1 + fileToken('a.ts').length,
    },
    {
      desc: 'stops before chip (left): text<chip><space><caret>',
      raw: `text${fileToken('a.ts')} `,
      offset: 4 + fileToken('a.ts').length + 1,
      dir: 'left' as const,
      expected: 4,
    },
    {
      desc: 'stops after chip (right): <caret><space><chip>more',
      raw: ` ${fileToken('a.ts')}more`,
      offset: 0,
      dir: 'right' as const,
      expected: 1 + fileToken('a.ts').length,
    },
  ])('$desc', ({ raw, offset, dir, expected }) => {
    const el = makeContainer(raw);
    expect(findWordBoundary(el, offset, dir)).toBe(expected);
  });
});

describe('handleChipNavigation — hardening edge cases', () => {
  // Cases 1–3: Single-step Alt+Arrow with whitespace/tab near chips
  it.each([
    {
      desc: 'Alt+Left: word<3 spaces><chip><caret> skips chip and all whitespace',
      raw: `word   ${fileToken('a.ts')}`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, el.childNodes.length),
      expectedOffset: 7,
    },
    {
      desc: 'Alt+Right: <caret><space><chip><space> jumps past chip',
      raw: ` ${fileToken('a.ts')} `,
      dir: 'Right' as const,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedOffset: 1 + fileToken('a.ts').length,
    },
    {
      desc: 'Alt+Left: <chip><tab><caret> treats tab as whitespace and skips chip',
      raw: `${fileToken('a.ts')}\t`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, '\t'), 1),
      expectedOffset: 0,
    },
  ])('$desc', ({ raw, dir, setupCursor, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(expectedOffset);
  });
  // Cases 4+5: Alt+Left/Right repeated traversal through mixed content (same layout)
  it.each([
    {
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => {
        const lastText = el.childNodes[el.childNodes.length - 1]!;
        setCursor(lastText, (lastText.textContent ?? '').length);
      },
      expectedOffsets: (_chip1End: number, chip2Start: number, chip2End: number) => [
        chip2End + 1,
        chip2Start,
        6,
        0,
      ],
    },
    {
      dir: 'Right' as const,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedOffsets: (chip1End: number, _chip2Start: number, chip2End: number) => [
        6,
        chip1End,
        chip2End,
        chip2End + 1,
        chip2End + 6,
      ],
    },
  ])(
    'Alt+$dir repeated: traverses all boundaries in "word1 <chip1> <chip2> word2"',
    ({ dir, setupCursor, expectedOffsets }) => {
      const chip1 = fileToken('a.ts');
      const chip2 = fileToken('b.ts');
      const el = makeContainer(`word1 ${chip1} ${chip2} word2`);
      const chip1End = 6 + chip1.length;
      const chip2Start = chip1End + 1;
      const chip2End = chip2Start + chip2.length;

      setupCursor(el);
      for (const expected of expectedOffsets(chip1End, chip2Start, chip2End)) {
        handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
        expect(getRawOffset(el)).toBe(expected);
      }
    }
  );
  // Case 6: Adjacent chips with text after — Right arrow at boundary
  it('Right arrow skips chip2 when between <chip1><chip2>text', () => {
    const tokenA = fileToken('a.ts');
    const tokenB = fileToken('b.ts');
    const el = makeContainer(`${tokenA}${tokenB}text`);
    // Set cursor at container level between chip1 and chip2
    setCursorLogical(el, 1);

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
    const textNode = findTextNode(el, 'word'); // "word" text node (after ZWS + chip)
    setCursor(textNode, 4);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
    expect(handled).toBe(true);
    // Should jump to start of "word" (after chip), not before chip
    expect(getRawOffset(el)).toBe(token.length);
  });
  // Case 9: Only whitespace in the input (no chips)
  it.each([
    { dir: 'Right' as const, startOffset: 0, expectedOffset: 3 },
    { dir: 'Left' as const, startOffset: 3, expectedOffset: 0 },
  ])(
    'Alt+Arrow$dir in whitespace-only input jumps to boundary',
    ({ dir, startOffset, expectedOffset }) => {
      const el = makeContainer('   ');
      const textNode = el.childNodes[0]!;
      setCursor(textNode, startOffset);

      const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
      expect(handled).toBe(true);
      expect(getRawOffset(el)).toBe(expectedOffset);
    }
  );
  // Case 10: Three adjacent chips with Alt+Left from end
  it('Alt+Left through 3 adjacent chips skips one at a time', () => {
    const len = fileToken('a.ts').length;
    const el = makeContainer(`${fileToken('a.ts')}${fileToken('b.ts')}${fileToken('c.ts')}`);
    setCursor(el, el.childNodes.length);

    for (const expected of [len * 2, len, 0]) {
      handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
});

describe('handleChipNavigation — hardening edge cases: round 2', () => {
  // Cases 1+2: Alt+Left multi-step traversal through punctuation/text + chip
  it.each([
    {
      desc: 'word.<chip><caret> — punctuation treated as word chars',
      raw: `word.${fileToken('a.ts')}`,
      expectedOffsets: [5, 0],
    },
    {
      desc: 'hello! <chip><caret> — stops before chip, then before hello!',
      raw: `hello! ${fileToken('a.ts')}`,
      expectedOffsets: [7, 0],
    },
  ])('Alt+Left: $desc', ({ raw, expectedOffsets }) => {
    const el = makeContainer(raw);
    setCursor(el, el.childNodes.length);
    for (const expected of expectedOffsets) {
      handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
  // Cases 3+4: Alt+Arrow from mid-word adjacent to chip — stops at word boundary, not past chip
  it.each([
    {
      desc: 'Alt+Right from mid-word before chip: hel|lo <chip> → stops after "lo "',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      dir: 'Right' as const,
      expectedOffset: 6,
    },
    {
      desc: 'Alt+Left from mid-word after chip: <chip>hel|lo → stops at start of "hello"',
      raw: `${fileToken('a.ts')}hello`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, 'hello'), 3),
      dir: 'Left' as const,
      expectedOffset: fileToken('a.ts').length,
    },
  ])('$desc', ({ raw, setupCursor, dir, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
    expect(getRawOffset(el)).toBe(expectedOffset);
  });
  // Case 5: Ping-pong — alternating left/right around a single chip
  it('ping-pong: alternating Left/Right around single chip stays stable', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`hello ${token} world`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 6);

    const steps: Array<['ArrowRight' | 'ArrowLeft', number]> = [
      ['ArrowRight', 6 + token.length],
      ['ArrowLeft', 6],
      ['ArrowRight', 6 + token.length],
      ['ArrowLeft', 6],
    ];
    for (const [key, expected] of steps) {
      handleChipNavigation(el, makeKeyEvent(key));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
  // Case 6+8+9+10: Alt+Left/Right multi-step traversals from end/start
  it.each([
    {
      desc: 'Alt+Left: the quick brown fox <chip><caret>',
      raw: `the quick brown fox ${fileToken('a.ts')}`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, el.childNodes.length),
      expectedOffsets: [20, 16, 10],
    },
    {
      desc: 'Alt+Right: <caret><chip1> <chip2> <chip3>',
      raw: `${fileToken('a.ts')} ${fileToken('b.ts')} ${fileToken('c.ts')}`,
      dir: 'Right' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, 0),
      expectedOffsets: [
        fileToken('a.ts').length,
        fileToken('a.ts').length + 1 + fileToken('b.ts').length,
        fileToken('a.ts').length + 1 + fileToken('b.ts').length + 1 + fileToken('c.ts').length,
      ],
    },
    {
      desc: 'Alt+Left: hello <chip> world — full left traversal',
      raw: `hello ${fileToken('a.ts')} world`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => {
        const lastText = el.childNodes[el.childNodes.length - 1]!;
        setCursor(lastText, (lastText.textContent ?? '').length);
      },
      expectedOffsets: [6 + fileToken('a.ts').length + 1, 6, 0],
    },
    {
      desc: 'Alt+Left: 👋hello <chip><caret> — treats emoji as part of word',
      raw: `👋hello ${fileToken('a.ts')}`,
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, el.childNodes.length),
      expectedOffsets: ['👋hello '.length, 0],
    },
  ])('$desc', ({ raw, dir, setupCursor, expectedOffsets }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    for (const expected of expectedOffsets) {
      handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
  // Case 7: Chip between two words with no spaces (direct adjacency)
  it('Alt+Left/Right: word1<chip>word2 — word boundaries respect chip as separator', () => {
    const token = fileToken('a.ts');
    const el = makeContainer(`word1${token}word2`);

    setCursor(el.childNodes[0]!, 0);
    const rightOffsets = [5, 5 + token.length, 5 + token.length + 5];
    for (const expected of rightOffsets) {
      handleChipNavigation(el, makeKeyEvent('ArrowRight', { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
    // Reverse: Alt+Left from end
    const lastText = el.childNodes[el.childNodes.length - 1]!;
    setCursor(lastText, (lastText.textContent ?? '').length);
    const leftOffsets = [5 + token.length, 5, 0];
    for (const expected of leftOffsets) {
      handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
});

describe('handleChipNavigation — Cmd+Left/Right (line start/end)', () => {
  const token = fileToken('a.ts');
  it.each([
    {
      dir: 'Left' as const,
      desc: 'chip at line start → position 0',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[1]!, 3),
      expectedOffset: 0,
    },
    {
      dir: 'Left' as const,
      desc: 'text then chip → position 0',
      raw: `hello ${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => {
        const lastText = el.childNodes[el.childNodes.length - 1]!;
        setCursor(lastText, (lastText.textContent ?? '').length);
      },
      expectedOffset: 0,
    },
    {
      dir: 'Right' as const,
      desc: 'chip at line end → end of content',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedOffset: 6 + fileToken('a.ts').length,
    },
    {
      dir: 'Right' as const,
      desc: 'chip then text → end of content',
      raw: `${fileToken('a.ts')} hello world`,
      setupCursor: (el: HTMLElement) => setCursor(el, 0),
      expectedOffset: fileToken('a.ts').length + ' hello world'.length,
    },
    {
      dir: 'Left' as const,
      desc: 'already at position 0 → still handled',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedOffset: 0,
    },
    {
      dir: 'Right' as const,
      desc: 'already at end → still handled',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedOffset: 5,
    },
  ])('Cmd+Arrow$dir: $desc', ({ dir, raw, setupCursor, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { metaKey: true }));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(expectedOffset);
  });
  it('Shift+Cmd+Arrow extends selection to line boundary (handled)', () => {
    const el = makeContainer(`${token} world`);
    const textNode = el.childNodes[1]!;
    setCursor(textNode, 3);

    const handled = handleChipNavigation(
      el,
      makeKeyEvent('ArrowLeft', { metaKey: true, shiftKey: true })
    );
    expect(handled).toBe(true);
  });
});

describe('handleChipNavigation — combinatoric matrix', () => {
  const CHIP_A = fileToken('a.ts');
  const CHIP_B = fileToken('b.ts');
  const CL = CHIP_A.length; // chip length = 23

  interface Layout {
    name: string;
    raw: string;
    totalLen: number;
    positions: Record<string, number>;
  }

  const layouts: Layout[] = [
    { name: 'chipOnly', raw: CHIP_A, totalLen: CL, positions: { start: 0, afterChipA: CL } },
    {
      name: 'textChip',
      raw: `hello ${CHIP_A}`,
      totalLen: 6 + CL,
      positions: { start: 0, midText: 3, beforeChipA: 6, end: 6 + CL },
    },
    {
      name: 'chipText',
      raw: `${CHIP_A} world`,
      totalLen: CL + 6,
      positions: { start: 0, afterChipA: CL, midText: CL + 3, end: CL + 6 },
    },
    {
      name: 'textChipText',
      raw: `hello ${CHIP_A} world`,
      totalLen: 6 + CL + 6,
      positions: {
        start: 0,
        midTextBefore: 3,
        beforeChipA: 6,
        afterChipA: 6 + CL,
        midTextAfter: 6 + CL + 3,
        end: 6 + CL + 6,
      },
    },
    {
      name: 'chipChip',
      raw: `${CHIP_A}${CHIP_B}`,
      totalLen: CL * 2,
      positions: { start: 0, betweenChips: CL, end: CL * 2 },
    },
    {
      name: 'chipTextChip',
      raw: `${CHIP_A} mid ${CHIP_B}`,
      totalLen: CL + 5 + CL,
      positions: {
        start: 0,
        afterChipA: CL,
        midText: CL + 2,
        beforeChipB: CL + 5,
        end: CL + 5 + CL,
      },
    },
  ];

  type Hotkey = 'Arrow' | 'Shift+Arrow' | 'Alt+Arrow' | 'Cmd+Arrow' | 'Shift+Cmd+Arrow';
  const hotkeys: Array<{
    name: Hotkey;
    makeEvent: (dir: 'ArrowLeft' | 'ArrowRight') => KeyboardEvent;
  }> = [
    { name: 'Arrow', makeEvent: (dir) => makeKeyEvent(dir) },
    { name: 'Shift+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { shiftKey: true }) },
    { name: 'Alt+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { altKey: true }) },
    { name: 'Cmd+Arrow', makeEvent: (dir) => makeKeyEvent(dir, { metaKey: true }) },
    {
      name: 'Shift+Cmd+Arrow',
      makeEvent: (dir) => makeKeyEvent(dir, { metaKey: true, shiftKey: true }),
    },
  ];

  interface MatrixCase {
    layout: string;
    hotkey: Hotkey;
    direction: 'Left' | 'Right';
    positionName: string;
    startOffset: number;
    expectedHandled: boolean;
    expectedOffset?: number;
  }

  const CHIP_RE = /\{file:\/\/workspace\/[^}]+\}/g;

  function findChipPositions(raw: string) {
    const chips: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = CHIP_RE.exec(raw)) !== null)
      chips.push({ start: m.index, end: m.index + m[0].length });
    CHIP_RE.lastIndex = 0;
    return chips;
  }

  function isAdjacentToChip(layout: Layout, offset: number, direction: 'Left' | 'Right') {
    for (const cp of findChipPositions(layout.raw)) {
      if (direction === 'Left' && cp.end === offset)
        return { handled: true, targetOffset: cp.start };
      if (direction === 'Right' && cp.start === offset)
        return { handled: true, targetOffset: cp.end };
    }
    return { handled: false } as { handled: boolean; targetOffset?: number };
  }

  interface Seg {
    type: 'text' | 'chip';
    content: string;
    start: number;
    end: number;
  }

  function buildSegments(raw: string): Seg[] {
    const segs: Seg[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = CHIP_RE.exec(raw)) !== null) {
      if (m.index > last)
        segs.push({
          type: 'text',
          content: raw.substring(last, m.index),
          start: last,
          end: m.index,
        });
      segs.push({ type: 'chip', content: m[0], start: m.index, end: m.index + m[0].length });
      last = m.index + m[0].length;
    }
    CHIP_RE.lastIndex = 0;
    if (last < raw.length)
      segs.push({ type: 'text', content: raw.substring(last), start: last, end: raw.length });
    return segs;
  }

  function textBoundary(text: string, offset: number, dir: 'Left' | 'Right'): number {
    let p = offset;
    if (dir === 'Left') {
      while (p > 0 && /\s/.test(text[p - 1]!)) p--;
      while (p > 0 && /\S/.test(text[p - 1]!)) p--;
    } else {
      while (p < text.length && /\S/.test(text[p]!)) p++;
      while (p < text.length && /\s/.test(text[p]!)) p++;
    }
    return p;
  }

  function isWhitespaceOnly(text: string, from: number, to: number): boolean {
    return from !== to && /^\s+$/.test(text.substring(Math.min(from, to), Math.max(from, to)));
  }

  function wordBoundary(
    segs: Seg[],
    fromOffset: number,
    totalLen: number,
    dir: 'Left' | 'Right'
  ): number {
    let pos = fromOffset;
    const fwd = dir === 'Right';
    const ordered = fwd ? segs : [...segs].reverse();
    // Inside a segment
    for (const seg of ordered) {
      const inside = fwd ? pos >= seg.start && pos < seg.end : pos > seg.start && pos <= seg.end;
      if (!inside) continue;
      if (seg.type === 'chip') return fwd ? seg.end : seg.start;
      const off = pos - seg.start;
      const nb = textBoundary(seg.content, off, dir);
      if (fwd ? nb > off : nb < off) {
        const reachedEnd = fwd ? nb === seg.content.length : nb === 0;
        if (!(reachedEnd && isWhitespaceOnly(seg.content, off, nb))) return seg.start + nb;
      }
      pos = fwd ? seg.end : seg.start;
      break;
    }
    // At segment boundary — scan next segments
    for (const seg of ordered) {
      const atBoundary = fwd ? seg.start === pos : seg.end === pos;
      if (!atBoundary) continue;
      if (seg.type === 'chip') return fwd ? seg.end : seg.start;
      const from = fwd ? 0 : seg.content.length;
      const nb = textBoundary(seg.content, from, dir);
      if (fwd ? nb > 0 : nb < seg.content.length) {
        const reachedEnd = fwd ? nb === seg.content.length : nb === 0;
        if (!(reachedEnd && isWhitespaceOnly(seg.content, from, nb))) return seg.start + nb;
      }
      pos = fwd ? seg.end : seg.start;
      // Check one more segment
      for (const next of ordered) {
        const nextAt = fwd ? next.start === pos : next.end === pos;
        if (!nextAt) continue;
        if (next.type === 'chip') return fwd ? next.end : next.start;
        const nFrom = fwd ? 0 : next.content.length;
        const nnb = textBoundary(next.content, nFrom, dir);
        if (fwd ? nnb > 0 : nnb < next.content.length) {
          const nReachedEnd = fwd ? nnb === next.content.length : nnb === 0;
          if (!(nReachedEnd && isWhitespaceOnly(next.content, nFrom, nnb))) return next.start + nnb;
        }
        pos = fwd ? next.end : next.start;
      }
      break;
    }
    return fwd ? totalLen : 0;
  }

  function computeAltArrowExpected(layout: Layout, offset: number, direction: 'Left' | 'Right') {
    if (direction === 'Left' && offset === 0) return { handled: false };
    if (direction === 'Right' && offset === layout.totalLen) return { handled: false };
    const target = wordBoundary(buildSegments(layout.raw), offset, layout.totalLen, direction);
    if (target === offset) return { handled: false };
    return { handled: true, targetOffset: target };
  }

  const cases: MatrixCase[] = [];
  for (const layout of layouts) {
    for (const posName of Object.keys(layout.positions)) {
      const startOffset = layout.positions[posName]!;
      for (const hotkey of hotkeys) {
        for (const direction of ['Left', 'Right'] as const) {
          let expectedHandled: boolean;
          let expectedOffset: number | undefined;

          if (hotkey.name === 'Shift+Arrow') {
            const result = isAdjacentToChip(layout, startOffset, direction);
            expectedHandled = result.handled;
            expectedOffset = undefined;
          } else if (hotkey.name === 'Shift+Cmd+Arrow') {
            expectedHandled = true;
            expectedOffset = undefined;
          } else if (hotkey.name === 'Cmd+Arrow') {
            expectedHandled = true;
            expectedOffset = direction === 'Left' ? 0 : layout.totalLen;
          } else if (hotkey.name === 'Arrow') {
            const result = isAdjacentToChip(layout, startOffset, direction);
            expectedHandled = result.handled;
            expectedOffset = result.targetOffset;
          } else {
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

  for (const layout of layouts) {
    describe(`layout: ${layout.name} — "${layout.raw.replace(/\{file:\/\/workspace\/([^}]+)\}/g, '[$1]')}"`, () => {
      const layoutCases = cases.filter((c) => c.layout === layout.name);
      it.each(layoutCases)(
        '$hotkey $direction @ $positionName (offset $startOffset) → handled=$expectedHandled',
        (tc) => {
          const el = makeContainer(layout.raw);
          setCursorToOffset(el, tc.startOffset);
          const hotkeyDef = hotkeys.find((h) => h.name === tc.hotkey)!;
          const event = hotkeyDef.makeEvent(tc.direction === 'Left' ? 'ArrowLeft' : 'ArrowRight');
          const handled = handleChipNavigation(el, event);
          expect(handled).toBe(tc.expectedHandled);
          if (tc.expectedHandled && tc.expectedOffset !== undefined) {
            expect(getRawOffset(el)).toBe(tc.expectedOffset);
          }
        }
      );
    });
  }
});

describe('handleChipNavigation — sequence tests', () => {
  const CHIP_A = fileToken('a.ts'); // 23 chars
  const CHIP_B = fileToken('b.ts'); // 23 chars
  const CHIP_C = fileToken('c.ts'); // 23 chars
  const CHIP_LEN = CHIP_A.length; // 23

  /** Run a sequence of keystrokes and verify offset after each. */
  function runSequence(
    el: HTMLElement,
    steps: Array<{
      event: KeyboardEvent;
      expectedHandled: boolean;
      expectedOffset?: number;
      setupOffset?: number;
    }>
  ): void {
    for (const step of steps) {
      if (step.setupOffset !== undefined) setCursorToOffset(el, step.setupOffset);
      const handled = handleChipNavigation(el, step.event);
      expect(handled).toBe(step.expectedHandled);
      if (step.expectedOffset !== undefined) expect(getRawOffset(el)).toBe(step.expectedOffset);
    }
  }
  it.each([
    {
      desc: 'Cmd+Left → ArrowRight: jumps to start then skips chip',
      raw: `${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => {
        const lastText = el.childNodes[el.childNodes.length - 1]!;
        setCursor(lastText, (lastText.textContent ?? '').length);
      },
      steps: [
        { key: 'ArrowLeft', opts: { metaKey: true }, handled: true, offset: 0 },
        { key: 'ArrowRight', opts: {}, handled: true, offset: CHIP_LEN },
      ],
    },
    {
      desc: 'Cmd+Right → ArrowLeft: jumps to end then skips chip back',
      raw: `hello ${CHIP_A}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      steps: [
        { key: 'ArrowRight', opts: { metaKey: true }, handled: true, offset: 6 + CHIP_LEN },
        { key: 'ArrowLeft', opts: {}, handled: true, offset: 6 },
      ],
    },
    {
      desc: 'ArrowRight past chip → Alt+Left back: round-trip around chip',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      steps: [
        { key: 'ArrowRight', opts: {}, handled: true, offset: 6 + CHIP_LEN },
        { key: 'ArrowLeft', opts: { altKey: true }, handled: true, offset: 6 },
      ],
    },
  ])('$desc', ({ raw, setupCursor, steps }) => {
    const el = makeContainer(raw);
    setupCursor(el);
    for (const step of steps) {
      const handled = handleChipNavigation(el, makeKeyEvent(step.key, step.opts));
      expect(handled).toBe(step.handled);
      expect(getRawOffset(el)).toBe(step.offset);
    }
  });
  it.each([
    {
      dir: 'Right' as const,
      setupCursor: (el: HTMLElement) => setCursorLogical(el, 0),
      offsets: [CHIP_LEN, CHIP_LEN * 2, CHIP_LEN * 3],
    },
    {
      dir: 'Left' as const,
      setupCursor: (el: HTMLElement) => setCursor(el, el.childNodes.length),
      offsets: [CHIP_LEN * 2, CHIP_LEN, 0],
    },
  ])('Arrow$dir ×3 through {chipA}{chipB}{chipC}', ({ dir, setupCursor, offsets }) => {
    const el = makeContainer(`${CHIP_A}${CHIP_B}${CHIP_C}`);
    setupCursor(el);
    for (const expected of offsets) {
      const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`));
      expect(handled).toBe(true);
      expect(getRawOffset(el)).toBe(expected);
    }
  });
  it('Alt+Left ×5 traverses all boundaries in "hello {chipA} world {chipB} end"', () => {
    const el = makeContainer(`hello ${CHIP_A} world ${CHIP_B} end`);
    const chipAEnd = 6 + CHIP_LEN; // 29
    const chipBStart = chipAEnd + 7; // 36
    const chipBEnd = chipBStart + CHIP_LEN; // 59
    const totalLen = chipBEnd + 4; // 63

    setCursorToOffset(el, totalLen);
    const expectedOffsets = [chipBEnd + 1, chipBStart, chipAEnd + 1, 6, 0];
    for (const expected of expectedOffsets) {
      handleChipNavigation(el, makeKeyEvent('ArrowLeft', { altKey: true }));
      expect(getRawOffset(el)).toBe(expected);
    }
  });
  it('navigate through {chipA} mid {chipB}: Arrow→ skip chip, then reach chipB, skip it', () => {
    const el = makeContainer(`${CHIP_A} mid ${CHIP_B}`);
    const chipAEnd = CHIP_LEN;
    const chipBStart = chipAEnd + 5;
    const chipBEnd = chipBStart + CHIP_LEN;

    setCursorLogical(el, 0);
    runSequence(el, [
      { event: makeKeyEvent('ArrowRight'), expectedHandled: true, expectedOffset: chipAEnd },
      { event: makeKeyEvent('ArrowRight'), expectedHandled: false },
      {
        event: makeKeyEvent('ArrowRight'),
        expectedHandled: true,
        expectedOffset: chipBEnd,
        setupOffset: chipBStart,
      },
      { event: makeKeyEvent('ArrowRight'), expectedHandled: false },
    ]);
  });
  it('Cmd+Left ×2 is idempotent: stays at offset 0', () => {
    const el = makeContainer(`hello ${CHIP_A} world`);
    const totalLen = 6 + CHIP_LEN + 6;
    setCursor(el.childNodes[0]!, 3);

    runSequence(el, [
      {
        event: makeKeyEvent('ArrowLeft', { metaKey: true }),
        expectedHandled: true,
        expectedOffset: 0,
      },
      {
        event: makeKeyEvent('ArrowLeft', { metaKey: true }),
        expectedHandled: true,
        expectedOffset: 0,
      },
      {
        event: makeKeyEvent('ArrowRight', { metaKey: true }),
        expectedHandled: true,
        expectedOffset: totalLen,
      },
      {
        event: makeKeyEvent('ArrowRight', { metaKey: true }),
        expectedHandled: true,
        expectedOffset: totalLen,
      },
    ]);
  });
});

describe('handleChipNavigation — Shift+Arrow selection', () => {
  const CHIP_A = fileToken('a.ts');
  const CHIP_B = fileToken('b.ts');
  const CHIP_LEN = CHIP_A.length; // 23

  it.each([
    {
      desc: 'Shift+Right before chip → chip fully selected',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      eventOpts: { key: 'ArrowRight', shiftKey: true },
      expectedAnchor: 6,
      expectedFocus: 6 + fileToken('a.ts').length,
    },
    {
      desc: 'Shift+Left after chip → chip fully selected',
      raw: `${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 0),
      eventOpts: { key: 'ArrowLeft', shiftKey: true },
      expectedAnchor: fileToken('a.ts').length,
      expectedFocus: 0,
    },
    {
      desc: 'Cmd+Shift+Right from middle → selects to end including chips',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      eventOpts: { key: 'ArrowRight', metaKey: true, shiftKey: true },
      expectedAnchor: 3,
      expectedFocus: 6 + fileToken('a.ts').length + 6,
    },
    {
      desc: 'Cmd+Shift+Left from middle → selects to start including chips',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[el.childNodes.length - 1]!, 3),
      eventOpts: { key: 'ArrowLeft', metaKey: true, shiftKey: true },
      expectedAnchor: 6 + fileToken('a.ts').length + 3,
      expectedFocus: 0,
    },
    {
      desc: 'Alt+Shift+Right → selects to next word boundary (past chip)',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      eventOpts: { key: 'ArrowRight', altKey: true, shiftKey: true },
      expectedAnchor: 6,
      expectedFocus: 6 + fileToken('a.ts').length,
    },
    {
      desc: 'Alt+Shift+Left → selects to previous word boundary (before chip)',
      raw: `${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 0),
      eventOpts: { key: 'ArrowLeft', altKey: true, shiftKey: true },
      expectedAnchor: fileToken('a.ts').length,
      expectedFocus: 0,
    },
  ])('$desc', ({ raw, setupCursor, eventOpts, expectedAnchor, expectedFocus }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const { key, ...opts } = eventOpts;
    const handled = handleChipNavigation(el, makeKeyEvent(key, opts));
    expect(handled).toBe(true);

    const offsets = getSelectionRawOffsets(el);
    expect(offsets).not.toBeNull();
    expect(offsets!.anchor).toBe(expectedAnchor);
    expect(offsets!.focus).toBe(expectedFocus);
  });
  it('Shift+ArrowRight ×2 across adjacent chips selects both', () => {
    const el = makeContainer(`${CHIP_A}${CHIP_B}`);
    setCursorLogical(el, 0); // Before chipA

    // Step 1: Shift+ArrowRight → select chipA
    const h1 = handleChipNavigation(el, makeKeyEvent('ArrowRight', { shiftKey: true }));
    expect(h1).toBe(true);
    let offsets = getSelectionRawOffsets(el);
    expect(offsets!.anchor).toBe(0);
    expect(offsets!.focus).toBe(CHIP_LEN);
    // Step 2: Shift+ArrowRight → extend selection to include chipB
    const h2 = handleChipNavigation(el, makeKeyEvent('ArrowRight', { shiftKey: true }));
    expect(h2).toBe(true);
    offsets = getSelectionRawOffsets(el);
    expect(offsets!.anchor).toBe(0);
    expect(offsets!.focus).toBe(CHIP_LEN * 2);
  });
  it.each([
    { dir: 'Right', cursorOffset: 3 },
    { dir: 'Left', cursorOffset: 5 },
  ])(
    'Shift+Arrow$dir in middle of text (no chip adjacent) returns false',
    ({ dir, cursorOffset }) => {
      const el = makeContainer('hello world');
      const textNode = el.childNodes[0]!;
      setCursor(textNode, cursorOffset);

      const handled = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { shiftKey: true }));
      expect(handled).toBe(false);
    }
  );
});

describe('handleChipNavigation — Home/End keys', () => {
  it.each([
    {
      key: 'Home',
      desc: 'from middle of text → position 0',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedOffset: 0,
    },
    {
      key: 'End',
      desc: 'from middle of text → end of content',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      expectedOffset: 11,
    },
    {
      key: 'Home',
      desc: 'when after a chip → position 0',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[1]!, 3),
      expectedOffset: 0,
    },
    {
      key: 'End',
      desc: 'when before a chip → end of content',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      expectedOffset: 6 + fileToken('a.ts').length,
    },
    {
      key: 'Home',
      desc: 'at position 0 stays at 0',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 0),
      expectedOffset: 0,
    },
    {
      key: 'End',
      desc: 'at end of content stays at end',
      raw: 'hello',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedOffset: 5,
    },
    {
      key: 'Home',
      desc: 'with multiple chips → position 0',
      raw: `hello ${fileToken('a.ts')} mid ${fileToken('b.ts')} world`,
      setupCursor: (el: HTMLElement) => {
        const lastTextNode = el.childNodes[el.childNodes.length - 1]!;
        setCursor(lastTextNode, 3);
      },
      expectedOffset: 0,
    },
    {
      key: 'End',
      desc: 'with multiple chips → end of content',
      raw: `hello ${fileToken('a.ts')} mid ${fileToken('b.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 2),
      expectedOffset: 6 + fileToken('a.ts').length + 5 + fileToken('b.ts').length + 6,
    },
    {
      key: 'Home',
      desc: 'positions before first chip when content starts with chip',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[1]!, 3),
      expectedOffset: 0,
    },
    {
      key: 'End',
      desc: 'positions after last chip when content ends with chip',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 2),
      expectedOffset: 6 + fileToken('a.ts').length,
    },
  ])('$key: $desc', ({ key, raw, setupCursor, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeKeyEvent(key));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(expectedOffset);
  });
  it.each([
    {
      key: 'Home',
      desc: 'from cursor to start (plain text)',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedAnchor: 5,
      expectedFocus: 0,
    },
    {
      key: 'Home',
      desc: 'from after chip to start',
      raw: `${fileToken('a.ts')} world`,
      setupCursor: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 3),
      expectedAnchor: fileToken('a.ts').length + 3,
      expectedFocus: 0,
    },
    {
      key: 'End',
      desc: 'from cursor to end (plain text)',
      raw: 'hello world',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 5),
      expectedAnchor: 5,
      expectedFocus: 11,
    },
    {
      key: 'End',
      desc: 'from before chip to end',
      raw: `hello ${fileToken('a.ts')}`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      expectedAnchor: 3,
      expectedFocus: 6 + fileToken('a.ts').length,
    },
  ])('Shift+$key: $desc', ({ key, raw, setupCursor, expectedAnchor, expectedFocus }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeKeyEvent(key, { shiftKey: true }));
    expect(handled).toBe(true);

    const offsets = getSelectionRawOffsets(el);
    expect(offsets).not.toBeNull();
    expect(offsets!.anchor).toBe(expectedAnchor);
    expect(offsets!.focus).toBe(expectedFocus);
  });
  it('other keys like ArrowUp are not handled', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    const handled = handleChipNavigation(el, makeKeyEvent('ArrowUp'));
    expect(handled).toBe(false);
  });
});

describe('handleChipNavigation — Ctrl+Arrow word skip', () => {
  const CHIP_A = fileToken('a.ts'); // {file://workspace/a.ts} = 23 chars
  const CHIP_A_LEN = CHIP_A.length;

  /** Make a Ctrl+key event. */
  function makeCtrlKeyEvent(key: string, options?: { shiftKey?: boolean }): KeyboardEvent {
    return new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      shiftKey: options?.shiftKey ?? false,
      bubbles: true,
    });
  }
  it.each([
    {
      dir: 'Right' as const,
      desc: 'with chip ahead → skips past chip',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      expectedOffset: 6 + CHIP_A_LEN,
    },
    {
      dir: 'Left' as const,
      desc: 'with chip behind → skips past chip',
      raw: `hello ${CHIP_A} world`,
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[2]!, 0),
      expectedOffset: 6,
    },
  ])('Ctrl+Arrow$dir $desc', ({ dir, raw, setupCursor, expectedOffset }) => {
    const el = makeContainer(raw);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeCtrlKeyEvent(`Arrow${dir}`));
    expect(handled).toBe(true);
    expect(getRawOffset(el)).toBe(expectedOffset);
  });
  it.each([
    { dir: 'Right' as const, startOffset: 0 },
    { dir: 'Left' as const, startOffset: 11 },
  ])(
    'Ctrl+Arrow$dir in text-only content → same behavior as Alt+Arrow$dir',
    ({ dir, startOffset }) => {
      const el = makeContainer('hello world');
      const textNode = el.childNodes[0]!;
      setCursor(textNode, startOffset);

      const handled = handleChipNavigation(el, makeCtrlKeyEvent(`Arrow${dir}`));
      expect(handled).toBe(true);
      const ctrlOffset = getRawOffset(el);

      setCursor(textNode, startOffset);
      const handled2 = handleChipNavigation(el, makeKeyEvent(`Arrow${dir}`, { altKey: true }));
      expect(handled2).toBe(true);
      expect(ctrlOffset).toBe(getRawOffset(el));
    }
  );
  it.each([
    {
      dir: 'Right' as const,
      desc: 'selects to next word boundary',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[0]!, 6),
      expectedAnchor: 6,
      expectedFocus: 6 + CHIP_A_LEN,
    },
    {
      dir: 'Left' as const,
      desc: 'selects to previous word boundary',
      setupCursor: (el: HTMLElement) => setCursor(el.childNodes[2]!, 0),
      expectedAnchor: 6 + CHIP_A_LEN,
      expectedFocus: 6,
    },
  ])('Ctrl+Shift+Arrow$dir → $desc', ({ dir, setupCursor, expectedAnchor, expectedFocus }) => {
    const el = makeContainer(`hello ${CHIP_A} world`);
    setupCursor(el);

    const handled = handleChipNavigation(el, makeCtrlKeyEvent(`Arrow${dir}`, { shiftKey: true }));
    expect(handled).toBe(true);

    const offsets = getSelectionRawOffsets(el);
    expect(offsets).not.toBeNull();
    expect(offsets!.anchor).toBe(expectedAnchor);
    expect(offsets!.focus).toBe(expectedFocus);
  });
});

describe('handleChipClick — mouse click on chip', () => {
  const CHIP_A = fileToken('a.ts');

  /**
   * Create a MouseEvent with a specific clientX targeting a node.
   * In jsdom, we can't rely on real layout, so we mock getBoundingClientRect.
   */
  function makeMouseEvent(clientX: number, target: EventTarget): MouseEvent {
    const event = new MouseEvent('click', {
      clientX,
      bubbles: true,
    });
    // jsdom doesn't set target from constructor — we need to dispatch from the element.
    // Instead we'll override the target property for direct calls.
    Object.defineProperty(event, 'target', { value: target, writable: false });
    return event;
  }

  /**
   * Mock getBoundingClientRect on a chip element so we can test left/right positioning.
   */
  function mockChipRect(chip: HTMLElement, left: number, width: number): void {
    chip.getBoundingClientRect = () => ({
      left,
      right: left + width,
      top: 0,
      bottom: 20,
      width,
      height: 20,
      x: left,
      y: 0,
      toJSON: () => ({}),
    });
  }
  it.each([
    { side: 'left half', clientX: 120, expectedSide: 'before', offsetDelta: 0 },
    { side: 'right half', clientX: 160, expectedSide: 'after', offsetDelta: 1 },
    { side: 'midpoint', clientX: 140, expectedSide: 'after', offsetDelta: 1 },
  ])(
    'click on $side of chip → cursor positioned $expectedSide chip',
    ({ clientX, offsetDelta }) => {
      const el = makeContainer(`hello ${CHIP_A} world`);
      const chip = el.querySelector('[data-file-ref]')!;
      mockChipRect(chip as HTMLElement, 100, 80); // left=100, width=80, midpoint=140

      const event = makeMouseEvent(clientX, chip);
      const handled = handleChipClick(el, event);
      expect(handled).toBe(true);

      const cursor = getCursor();
      expect(cursor).not.toBeNull();
      const chipIndex = Array.from(el.childNodes).indexOf(chip as ChildNode);
      expect(cursor!.node).toBe(el);
      expect(cursor!.offset).toBe(chipIndex + offsetDelta);
    }
  );
  it('click on text (not chip) → returns false', () => {
    const el = makeContainer('hello world');
    const textNode = el.childNodes[0]!;

    const event = makeMouseEvent(50, textNode);
    const handled = handleChipClick(el, event);
    expect(handled).toBe(false);
  });
  it('click on nested element inside chip → positions cursor at chip boundary', () => {
    const el = makeContainer(`${CHIP_A}`);
    const chip = el.querySelector('[data-file-ref]')! as HTMLElement;
    mockChipRect(chip, 0, 100); // midpoint=50

    // Simulate clicking on a text node inside the chip
    const innerNode = chip.firstChild ?? chip;
    const event = makeMouseEvent(70, innerNode); // 70 > 50 → right half
    const handled = handleChipClick(el, event);
    expect(handled).toBe(true);

    const cursor = getCursor();
    expect(cursor).not.toBeNull();
    const chipIndex = Array.from(el.childNodes).indexOf(chip);
    expect(cursor!.node).toBe(el);
    expect(cursor!.offset).toBe(chipIndex + 1); // after chip
  });
  it('click with target outside container → returns false', () => {
    const el = makeContainer(`hello ${CHIP_A}`);
    const outsideNode = document.createElement('div');
    document.body.appendChild(outsideNode);

    const event = makeMouseEvent(50, outsideNode);
    const handled = handleChipClick(el, event);
    expect(handled).toBe(false);

    document.body.removeChild(outsideNode);
  });
});

describe('sanitizeCursorPosition — focus restore', () => {
  const CHIP_A = fileToken('a.ts');

  /**
   * Force the selection's anchorNode inside a chip by manually setting it
   * to a text node within the chip span.
   */
  function setCursorInsideChip(chip: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    // Try to position inside the chip's first child (usually a text node)
    const inner = chip.firstChild ?? chip;
    if (inner.nodeType === Node.TEXT_NODE) {
      range.setStart(inner, 0);
    } else {
      range.setStart(chip, 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  it('cursor inside chip → moved after chip, returns true', () => {
    const el = makeContainer(`hello ${CHIP_A} world`);
    const chip = el.querySelector('[data-file-ref]')! as HTMLElement;
    setCursorInsideChip(chip);

    const corrected = sanitizeCursorPosition(el);
    expect(corrected).toBe(true);
    // Cursor should now be after the chip (not inside it)
    const cursor = getCursor();
    expect(cursor).not.toBeNull();
    const chipIndex = Array.from(el.childNodes).indexOf(chip);
    expect(cursor!.node).toBe(el);
    expect(cursor!.offset).toBe(chipIndex + 1);
  });
  it.each([
    {
      desc: 'cursor in text position → returns false, no change',
      setup: (el: HTMLElement) => setCursor(el.childNodes[0]!, 3),
      raw: `hello ${CHIP_A} world`,
    },
    {
      desc: 'cursor before chip (at container level) → returns false',
      setup: (el: HTMLElement) => setCursor(el, 0),
      raw: `${CHIP_A} world`,
    },
    {
      desc: 'cursor after chip → returns false',
      setup: (el: HTMLElement) => setCursor(findTextNode(el, ' world'), 0),
      raw: `${CHIP_A} world`,
    },
    {
      desc: 'no selection → returns false',
      setup: () => window.getSelection()?.removeAllRanges(),
      raw: `hello ${CHIP_A}`,
    },
  ])('$desc', ({ raw, setup }) => {
    const el = makeContainer(raw);
    setup(el);
    expect(sanitizeCursorPosition(el)).toBe(false);
  });
});

describe('handleChipNavigation — Delete/Backspace at newline+chip boundary', () => {
  const CHIP_A = fileToken('a.ts'); // {file://workspace/a.ts} = 23 chars
  const CHIP_B = fileToken('b.ts');
  it('Delete at end of text before <br> + chip → removes only <br>, chip preserved', () => {
    // DOM: "hello" <br> <chip_a>
    const el = makeContainer(`hello\n${CHIP_A}`);
    const textNode = el.childNodes[0]!; // "hello"
    expect(textNode.textContent).toBe('hello');
    // Position cursor at end of "hello"
    setCursor(textNode, 5);

    const event = makeKeyEvent('Delete');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(true);
    // <br> should be removed; chip should still exist
    const chip = el.querySelector('[data-file-ref]');
    expect(chip).not.toBeNull();
    // No <br> should remain
    expect(el.querySelector('br')).toBeNull();
    // Container should have: "hello" text + chip
    expect(el.childNodes.length).toBe(2);
    expect(el.childNodes[0]!.textContent).toBe('hello');
    expect((el.childNodes[1] as HTMLElement).hasAttribute('data-file-ref')).toBe(true);
  });
  it('Delete at end of text before <br> + text (no chip) → not intercepted', () => {
    // DOM: "hello" <br> "world"
    const el = makeContainer(`hello\nworld`);
    const textNode = el.childNodes[0]!; // "hello"
    expect(textNode.textContent).toBe('hello');
    // Position cursor at end of "hello"
    setCursor(textNode, 5);

    const event = makeKeyEvent('Delete');
    const handled = handleChipNavigation(el, event);
    // Should NOT be intercepted — no chip after <br>
    expect(handled).toBe(false);
    // DOM should be unchanged
    expect(el.querySelector('br')).not.toBeNull();
  });
  it('Delete at end of chip before <br> + chip → removes only <br>', () => {
    // DOM (with ZWS): [ZWS][chip_a][<br>][ZWS][chip_b]
    const el = makeContainer(`${CHIP_A}\n${CHIP_B}`);
    // Find chip_a and set cursor after it
    const chipA = el.querySelector('[data-file-ref]')!;
    expect(chipA).not.toBeNull();
    // Set cursor at container level after chip_a — the <br> should be the next child
    const chipAIndex = Array.from(el.childNodes).indexOf(chipA);
    setCursor(el, chipAIndex + 1);

    const event = makeKeyEvent('Delete');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(true);
    expect(el.querySelector('br')).toBeNull();
    // Both chips should remain
    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(2);
  });
  it('Delete in middle of text → not intercepted', () => {
    const el = makeContainer(`hello\n${CHIP_A}`);
    const textNode = el.childNodes[0]!; // "hello"

    // Cursor in middle of "hello", not at end
    setCursor(textNode, 3);

    const event = makeKeyEvent('Delete');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(false);
  });
  it('Backspace at start of text after <br> preceded by chip → removes only <br>', () => {
    // DOM (with ZWS): [ZWS][chip_a][<br>]["world"]
    const el = makeContainer(`${CHIP_A}\nworld`);
    const textNode = findTextNode(el, 'world');
    expect(textNode.textContent).toBe('world');
    // Position cursor at start of "world"
    setCursor(textNode, 0);

    const event = makeKeyEvent('Backspace');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(true);
    // <br> removed, chip preserved
    expect(el.querySelector('br')).toBeNull();
    const chip = el.querySelector('[data-file-ref]');
    expect(chip).not.toBeNull();
  });
  it('Backspace at start of chip after <br> preceded by text → removes only <br>', () => {
    // DOM: "hello" <br> <chip_a>
    const el = makeContainer(`hello\n${CHIP_A}`);
    // childNodes: ["hello", <br>, chip_a]
    // To backspace at start of the line with chip, cursor is at container level
    // offset 2 means "between child 1 (<br>) and child 2 (chip)"
    // prev child at offset-1 = child[1] = <br>
    // afterBr = chip (has data-file-ref) → intercept
    setCursor(el, 2);

    const event = makeKeyEvent('Backspace');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(true);
    expect(el.querySelector('br')).toBeNull();
    const chip = el.querySelector('[data-file-ref]');
    expect(chip).not.toBeNull();
    expect(el.childNodes[0]!.textContent).toBe('hello');
  });
  it('Backspace at start of text after <br> preceded by text (no chip) → not intercepted', () => {
    // DOM: "hello" <br> "world"
    const el = makeContainer(`hello\nworld`);
    const textNode = el.childNodes[2]!; // "world"

    // Position cursor at start of "world"
    setCursor(textNode, 0);

    const event = makeKeyEvent('Backspace');
    const handled = handleChipNavigation(el, event);
    // No chip on either side of <br> → not intercepted
    expect(handled).toBe(false);
    expect(el.querySelector('br')).not.toBeNull();
  });
  it('Backspace in middle of text → not intercepted', () => {
    const el = makeContainer(`${CHIP_A}\nworld`);
    const textNode = findTextNode(el, 'world');
    // Cursor in middle of "world", not at start
    setCursor(textNode, 3);

    const event = makeKeyEvent('Backspace');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(false);
  });
  it('Backspace at container level after <br> between two chips → removes only <br>', () => {
    // DOM (with ZWS): [ZWS][chip_a][<br>][ZWS][chip_b]
    const el = makeContainer(`${CHIP_A}\n${CHIP_B}`);
    // Find the <br> and set cursor after it
    const brNode = el.querySelector('br')!;
    const brIndex = Array.from(el.childNodes).indexOf(brNode);
    // Cursor at container level after <br> → prevChild is <br>
    setCursor(el, brIndex + 1);

    const event = makeKeyEvent('Backspace');
    const handled = handleChipNavigation(el, event);

    expect(handled).toBe(true);
    expect(el.querySelector('br')).toBeNull();
    const chips = el.querySelectorAll('[data-file-ref]');
    expect(chips.length).toBe(2);
  });
  it('dispatches input event after removing <br>', () => {
    const el = makeContainer(`hello\n${CHIP_A}`);
    const textNode = el.childNodes[0]!;
    setCursor(textNode, 5);

    let inputFired = false;
    el.addEventListener('input', () => {
      inputFired = true;
    });

    const event = makeKeyEvent('Delete');
    handleChipNavigation(el, event);

    expect(inputFired).toBe(true);
  });
});
