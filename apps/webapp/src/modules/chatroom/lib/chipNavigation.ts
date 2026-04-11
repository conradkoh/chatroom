/**
 * Custom keyboard navigation for file reference chips in a contenteditable element.
 *
 * Chips are `<span contenteditable="false" data-file-ref="...">` elements that the
 * browser treats as atomic inline blocks. This module intercepts arrow key events
 * to provide deterministic cursor behavior around those chips:
 *
 * - **Left/Right Arrow**: skip over a chip as a unit when the cursor is adjacent to it
 * - **Alt+Arrow** (macOS) / **Ctrl+Arrow** (Windows/Linux): treat each chip as a "word" boundary
 *
 * Both Alt+Arrow (macOS) and Ctrl+Arrow (Windows/Linux) are handled for word-skip.
 */

import {
  stripZws,
  computeRawOffset,
  resolveRawOffsetToDom,
  setCursorToRawOffset,
} from '@/lib/domOffsetUtils';

// ── Public helpers ───────────────────────────────────────────────────────────

/** Check if a DOM node is a chip span (has data-file-ref attribute). */
export function isChipNode(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute('data-file-ref');
}

/**
 * Get the chip node adjacent to the current cursor position.
 *
 * @param direction - 'before' means check if a chip is immediately before the cursor,
 *                    'after' means check if a chip is immediately after the cursor.
 * @returns The chip HTMLElement if found, null otherwise.
 */
export function getAdjacentChip(
  container: HTMLElement,
  direction: 'before' | 'after'
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || !container.contains(anchorNode)) return null;

  if (anchorNode === container || anchorNode.nodeType === Node.ELEMENT_NODE) {
    // Cursor is at container/element level — anchorOffset is a child index
    const parent = anchorNode as HTMLElement;
    if (direction === 'before') {
      const prev = parent.childNodes[anchorOffset - 1];
      if (prev && isChipNode(prev)) return prev;
    } else {
      const next = parent.childNodes[anchorOffset];
      if (next && isChipNode(next)) return next;
    }
    return null;
  }

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? '';
    const isZwsOnly = stripZws(text).length === 0 && text.length > 0;
    if (direction === 'after' && (anchorOffset === text.length || isZwsOnly)) {
      // At the end of a text node (or ZWS-only node) — check if next sibling is a chip
      const next = anchorNode.nextSibling;
      if (next && isChipNode(next)) return next;
    }
    if (direction === 'before' && (anchorOffset === 0 || isZwsOnly)) {
      // At the start of a text node (or ZWS-only node) — check if previous sibling is a chip
      const prev = anchorNode.previousSibling;
      if (prev && isChipNode(prev)) return prev;
    }
  }

  return null;
}

/**
 * Like getAdjacentChip but checks the selection's focus point (not anchor).
 * Works with both collapsed and non-collapsed selections, enabling Shift+Arrow
 * to extend selection across chips.
 */
function getAdjacentChipFromFocus(
  container: HTMLElement,
  direction: 'before' | 'after'
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const focusNode = selection.focusNode;
  const focusOffset = selection.focusOffset;
  if (!focusNode || !container.contains(focusNode)) return null;

  if (focusNode === container || focusNode.nodeType === Node.ELEMENT_NODE) {
    const parent = focusNode as HTMLElement;
    if (direction === 'before') {
      const prev = parent.childNodes[focusOffset - 1];
      if (prev && isChipNode(prev)) return prev;
    } else {
      const next = parent.childNodes[focusOffset];
      if (next && isChipNode(next)) return next;
    }
    return null;
  }

  if (focusNode.nodeType === Node.TEXT_NODE) {
    const text = focusNode.textContent ?? '';
    const isZwsOnly = stripZws(text).length === 0 && text.length > 0;
    if (direction === 'after' && (focusOffset === text.length || isZwsOnly)) {
      const next = focusNode.nextSibling;
      if (next && isChipNode(next)) return next;
    }
    if (direction === 'before' && (focusOffset === 0 || isZwsOnly)) {
      const prev = focusNode.previousSibling;
      if (prev && isChipNode(prev)) return prev;
    }
  }

  return null;
}

/**
 * Find a word boundary in the contenteditable, treating chips as atomic words.
 *
 * Linearizes the container's content into a sequence of segments (text runs and chips),
 * computes the current raw offset, then scans left or right for the next word boundary.
 *
 * @param container - The contenteditable root element.
 * @param fromRawOffset - The current cursor position as a raw text offset.
 * @param direction - 'left' to find previous boundary, 'right' to find next.
 * @returns The raw offset of the word boundary.
 */
export function findWordBoundary(
  container: HTMLElement,
  fromRawOffset: number,
  direction: 'left' | 'right'
): number {
  // Build a flat list of segments: text runs and chip tokens
  const segments = buildSegments(container);
  if (segments.length === 0) return fromRawOffset;

  if (direction === 'left') {
    return findWordBoundaryLeft(segments, fromRawOffset);
  } else {
    return findWordBoundaryRight(segments, fromRawOffset);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

/**
 * Handle keyboard navigation around non-editable chip spans.
 *
 * @returns true if the event was handled (caller should preventDefault), false otherwise.
 */
export function handleChipNavigation(container: HTMLElement, e: KeyboardEvent): boolean {
  // Home/End keys — line jump (equivalent to Cmd+Arrow on macOS)
  if (e.key === 'Home' || e.key === 'End') {
    const target = e.key === 'Home' ? 'start' : 'end';
    if (e.shiftKey) {
      return handleShiftLineJump(container, target);
    }
    return handleLineJump(container, target);
  }

  // Delete/Backspace at newline+chip boundary — remove only the newline
  if (e.key === 'Delete' || e.key === 'Backspace') {
    return handleDeleteAtNewlineChipBoundary(container, e.key);
  }

  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;

  const direction = e.key === 'ArrowLeft' ? 'left' : 'right';

  // Shift+Arrow — selection-extending variants
  if (e.shiftKey) {
    if (e.metaKey) {
      // Cmd+Shift+Arrow (macOS) — extend selection to line start/end
      return handleShiftLineJump(container, direction === 'left' ? 'start' : 'end');
    }
    if (e.altKey || e.ctrlKey) {
      // Alt+Shift+Arrow (macOS) or Ctrl+Shift+Arrow (Win/Linux) — extend selection by word
      return handleShiftWordSkip(container, direction);
    }
    // Shift+Arrow — extend selection across adjacent chip
    return handleShiftSingleStep(container, direction);
  }

  // Cmd+Arrow (macOS) — move to line start/end, handling chips correctly
  if (e.metaKey) {
    return handleLineJump(container, direction === 'left' ? 'start' : 'end');
  }

  if (e.altKey || e.ctrlKey) {
    // Alt+Arrow (macOS) or Ctrl+Arrow (Win/Linux) — word skip
    return handleWordSkip(container, direction);
  }

  return handleSingleStep(container, direction);
}

// ── Mouse click handler ──────────────────────────────────────────────────────

/**
 * Handle mouse clicks on chip elements in a contenteditable container.
 *
 * When a user clicks directly on a chip (contenteditable="false" span), the browser
 * may leave the cursor inside the chip or at an inconsistent position. This handler
 * detects clicks on chips and positions the cursor before or after the chip based
 * on whether the click was closer to the left or right edge.
 *
 * @returns true if the click was on a chip and cursor was repositioned, false otherwise.
 */
export function handleChipClick(container: HTMLElement, e: MouseEvent): boolean {
  const target = e.target as Node;
  if (!target || !container.contains(target)) return false;

  // Walk up from click target to find a chip node (but stop at the container)
  const chip = findChipAncestor(target, container);
  if (!chip) return false;

  // Determine if the click is closer to the left or right edge of the chip
  const rect = chip.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;

  if (e.clientX < midpoint) {
    setCursorBeforeNode(chip);
  } else {
    setCursorAfterNode(chip);
  }

  return true;
}

/** Walk up from a node to find a chip ancestor (stops at container). */
function findChipAncestor(node: Node, container: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== container) {
    if (isChipNode(current)) return current;
    current = current.parentNode;
  }
  return null;
}

// ── Focus restore ────────────────────────────────────────────────────────────

/**
 * Sanitize the cursor position after focus is restored to the contenteditable.
 *
 * When the input regains focus (e.g., after a dialog closes or React re-render),
 * the browser may place the cursor inside a chip span. This function detects that
 * and moves the cursor to after the chip.
 *
 * @returns true if a correction was made, false otherwise.
 */
export function sanitizeCursorPosition(container: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const { anchorNode } = selection;
  if (!anchorNode || !container.contains(anchorNode)) return false;

  // Check if anchorNode is inside a chip
  const chip = findChipAncestor(anchorNode, container);
  if (!chip) return false;

  // Move cursor to after the chip
  setCursorAfterNode(chip);
  return true;
}

// ── Internal: Delete/Backspace at newline+chip boundary ──────────────────────

/**
 * Handle Delete or Backspace when the cursor is at a newline boundary adjacent to a chip.
 *
 * Problem: The browser's default Delete/Backspace behavior at a `<br>` element followed by
 * (or preceded by) a `contenteditable="false"` chip span removes both the `<br>` AND the chip.
 * We want to remove only the `<br>` and preserve the chip.
 *
 * Strategy:
 * - For Delete: check if the next content is `<br>` followed by a chip
 * - For Backspace: check if the previous content is `<br>` preceded by any content
 *   where the element after `<br>` is a chip (or cursor is at start of line with chip)
 * - Remove only the `<br>` from the DOM
 * - Dispatch an `input` event so ContentEditableInput's onInput handler fires
 *
 * @returns true if handled (caller should preventDefault), false to let browser handle normally.
 */
function handleDeleteAtNewlineChipBoundary(
  container: HTMLElement,
  key: 'Delete' | 'Backspace'
): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || !container.contains(anchorNode)) return false;

  if (key === 'Delete') {
    return handleDeleteForward(container, anchorNode, anchorOffset);
  } else {
    return handleBackwardDelete(container, anchorNode, anchorOffset);
  }
}

/**
 * Delete key: cursor is at end of line, next sibling chain is <br> + chip.
 * Remove only the <br>.
 */
function handleDeleteForward(
  container: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): boolean {
  let brNode: Node | null = null;

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? '';
    if (anchorOffset !== text.length) return false; // Not at end of text node
    // Check if next sibling is <br>
    const next = anchorNode.nextSibling;
    if (next && isElementWithTag(next, 'BR')) {
      brNode = next;
    }
  } else if (anchorNode === container || anchorNode.nodeType === Node.ELEMENT_NODE) {
    // Cursor at container/element level — anchorOffset is child index
    const parent = anchorNode as HTMLElement;
    const nextChild = parent.childNodes[anchorOffset];
    if (nextChild && isElementWithTag(nextChild, 'BR')) {
      brNode = nextChild;
    }
  }

  if (!brNode) return false;

  // Check what follows the <br> (skip over ZWS-only text nodes)
  let afterBr = brNode.nextSibling;
  while (afterBr && isZwsOnlyTextNode(afterBr)) {
    afterBr = afterBr.nextSibling;
  }
  if (!afterBr || !isChipNode(afterBr)) return false;

  // We have <br> followed by a chip (possibly with ZWS between) — remove only the <br>
  // Also remove any ZWS text nodes between <br> and chip
  let node = brNode.nextSibling;
  while (node && isZwsOnlyTextNode(node)) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
  brNode.parentNode?.removeChild(brNode);
  container.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/**
 * Backspace key: cursor is at start of line, previous sibling chain includes <br>.
 * The <br> is between previous content and the current line which starts with a chip (or cursor).
 * Remove only the <br>.
 */
function handleBackwardDelete(
  container: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): boolean {
  let brNode: Node | null = null;

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    if (anchorOffset !== 0) return false; // Not at start of text node
    // Check if previous sibling is <br>
    const prev = anchorNode.previousSibling;
    if (prev && isElementWithTag(prev, 'BR')) {
      brNode = prev;
    }
  } else if (anchorNode === container || anchorNode.nodeType === Node.ELEMENT_NODE) {
    // Cursor at container/element level
    const parent = anchorNode as HTMLElement;
    const prevChild = parent.childNodes[anchorOffset - 1];
    if (prevChild && isElementWithTag(prevChild, 'BR')) {
      brNode = prevChild;
    }
  }

  if (!brNode) return false;

  // For Backspace, check what's around the <br> (skip ZWS-only text nodes)
  let afterBr: Node | null = brNode.nextSibling;
  while (afterBr && isZwsOnlyTextNode(afterBr)) {
    afterBr = afterBr.nextSibling;
  }
  let beforeBr: Node | null = brNode.previousSibling;
  while (beforeBr && isZwsOnlyTextNode(beforeBr)) {
    beforeBr = beforeBr.previousSibling;
  }

  // We intercept if either side of the <br> has a chip
  const chipAfterBr = afterBr && isChipNode(afterBr);
  const chipBeforeBr = beforeBr && isChipNode(beforeBr);

  if (!chipAfterBr && !chipBeforeBr) return false;

  // Remove ZWS text nodes between <br> and the chip on the after side
  let node: Node | null = brNode.nextSibling;
  while (node && isZwsOnlyTextNode(node)) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
  // Remove only the <br>
  brNode.parentNode?.removeChild(brNode);
  container.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Check if a node is an element with a specific tag name. */
function isElementWithTag(node: Node, tag: string): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === tag;
}

/** Check if a node is a ZWS-only text node (contains only zero-width spaces). */
function isZwsOnlyTextNode(node: Node): boolean {
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? '';
  return text.length > 0 && stripZws(text).length === 0;
}

// ── Internal: single-step navigation ─────────────────────────────────────────

function handleSingleStep(container: HTMLElement, direction: 'left' | 'right'): boolean {
  if (direction === 'left') {
    const chip = getAdjacentChip(container, 'before');
    if (chip) {
      setCursorBeforeNode(chip);
      return true;
    }
  } else {
    const chip = getAdjacentChip(container, 'after');
    if (chip) {
      setCursorAfterNode(chip);
      return true;
    }
  }
  return false;
}

// ── Internal: word-skip navigation ───────────────────────────────────────────

function handleWordSkip(container: HTMLElement, direction: 'left' | 'right'): boolean {
  const currentOffset = getCurrentRawOffset(container);
  if (currentOffset === null) return false;

  const targetOffset = findWordBoundary(container, currentOffset, direction);
  if (targetOffset === currentOffset) return false;

  setCursorToRawOffset(container, targetOffset);
  return true;
}

// ── Internal: line-jump navigation (Cmd+Arrow) ──────────────────────────────

function handleLineJump(container: HTMLElement, target: 'start' | 'end'): boolean {
  if (target === 'start') {
    setCursorToRawOffset(container, 0);
  } else {
    const segments = buildSegments(container);
    const totalLength =
      segments.length > 0
        ? (() => {
            const last = segments[segments.length - 1]!;
            return last.start + (last.type === 'text' ? last.text.length : last.token.length);
          })()
        : 0;
    setCursorToRawOffset(container, totalLength);
  }
  return true;
}

// ── Internal: Shift+Arrow selection handlers ─────────────────────────────────

/** Shift+Arrow: extend selection across an adjacent chip. */
function handleShiftSingleStep(container: HTMLElement, direction: 'left' | 'right'): boolean {
  const chip = getAdjacentChipFromFocus(container, direction === 'left' ? 'before' : 'after');
  if (!chip) return false;

  if (direction === 'left') {
    extendSelectionToRawOffset(container, getNodeRawOffset(container, chip));
  } else {
    const chipRef = chip.getAttribute('data-file-ref') ?? '';
    extendSelectionToRawOffset(container, getNodeRawOffset(container, chip) + chipRef.length);
  }
  return true;
}

/** Alt+Shift+Arrow: extend selection to word boundary. */
function handleShiftWordSkip(container: HTMLElement, direction: 'left' | 'right'): boolean {
  const currentOffset = getSelectionFocusRawOffset(container);
  if (currentOffset === null) return false;

  const targetOffset = findWordBoundary(container, currentOffset, direction);
  if (targetOffset === currentOffset) return false;

  extendSelectionToRawOffset(container, targetOffset);
  return true;
}

/** Cmd+Shift+Arrow: extend selection to line start/end. */
function handleShiftLineJump(container: HTMLElement, target: 'start' | 'end'): boolean {
  if (target === 'start') {
    extendSelectionToRawOffset(container, 0);
  } else {
    const segments = buildSegments(container);
    const totalLength =
      segments.length > 0
        ? (() => {
            const last = segments[segments.length - 1]!;
            return last.start + (last.type === 'text' ? last.text.length : last.token.length);
          })()
        : 0;
    extendSelectionToRawOffset(container, totalLength);
  }
  return true;
}

/** Get the raw offset of the selection's focus point (not anchor). */
function getSelectionFocusRawOffset(container: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const { focusNode, focusOffset } = selection;
  if (!focusNode || !container.contains(focusNode)) return null;

  return computeRawOffset(container, focusNode, focusOffset);
}

/** Get the raw offset of a chip node's start within the container. */
function getNodeRawOffset(container: HTMLElement, targetNode: Node): number {
  let offset = 0;

  for (const node of Array.from(container.childNodes)) {
    if (node === targetNode) return offset;

    if (node.nodeType === Node.TEXT_NODE) {
      offset += stripZws(node.textContent ?? '').length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        offset += fileRef.length;
      } else if (el.tagName === 'BR') {
        offset += 1;
      } else {
        offset += (el.textContent ?? '').length;
      }
    }
  }
  return offset;
}

/**
 * Extend the current selection's focus to a raw offset, preserving the anchor.
 * Uses selection.extend() to move only the focus point.
 */
function extendSelectionToRawOffset(container: HTMLElement, targetOffset: number): void {
  const { node: targetNode, offset: targetDomOffset } = resolveRawOffsetToDom(
    container,
    targetOffset
  );
  if (!targetNode) return;

  const selection = window.getSelection();
  if (!selection) return;

  // selection.extend() moves the focus while keeping the anchor
  try {
    selection.extend(targetNode, targetDomOffset);
  } catch {
    // Fallback: manually construct the range if extend() fails
    if (selection.rangeCount === 0) return;
    const anchorNode = selection.anchorNode;
    const anchorOffset = selection.anchorOffset;
    if (!anchorNode) return;

    const newRange = document.createRange();
    newRange.setStart(anchorNode, anchorOffset);
    newRange.setEnd(targetNode, targetDomOffset);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
}

// ── Internal: segment model ──────────────────────────────────────────────────

interface TextSegment {
  type: 'text';
  text: string;
  start: number; // raw offset of segment start
}

interface ChipSegment {
  type: 'chip';
  token: string;
  start: number;
}

type Segment = TextSegment | ChipSegment;

/**
 * Flatten the container's child nodes into a linear list of text and chip segments,
 * each annotated with its starting raw offset.
 */
function buildSegments(container: HTMLElement): Segment[] {
  const segments: Segment[] = [];
  let offset = 0;

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = stripZws(node.textContent ?? '');
      if (text.length > 0) {
        segments.push({ type: 'text', text, start: offset });
        offset += text.length;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        segments.push({ type: 'chip', token: fileRef, start: offset });
        offset += fileRef.length;
      } else if (el.tagName === 'BR') {
        segments.push({ type: 'text', text: '\n', start: offset });
        offset += 1;
      } else {
        // Recurse into other elements (e.g., <div> for newlines)
        // For simplicity, treat inner text content as text segments
        const innerText = el.textContent ?? '';
        if (innerText.length > 0) {
          segments.push({ type: 'text', text: innerText, start: offset });
          offset += innerText.length;
        }
      }
    }
  }

  return segments;
}

function findWordBoundaryLeft(segments: Segment[], fromOffset: number): number {
  // Walk backward through segments to find the previous word boundary
  let pos = fromOffset;

  // Find which segment we're currently in
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    const segEnd = seg.start + (seg.type === 'text' ? seg.text.length : seg.token.length);

    if (pos > segEnd) continue; // Segment is entirely before our position
    if (pos <= seg.start) continue; // We're at or before the start of this segment

    // We're inside this segment
    if (seg.type === 'chip') {
      // Jump to before the chip
      return seg.start;
    }

    // Text segment — find previous word boundary within the text
    const offsetInText = pos - seg.start;
    const newOffsetInText = findTextWordBoundaryLeft(seg.text, offsetInText);
    if (newOffsetInText < offsetInText) {
      // If we landed at position 0 and only consumed whitespace (no word chars),
      // continue scanning backward to skip an adjacent chip as part of the same word-skip.
      const onlySkippedWhitespace =
        newOffsetInText === 0 && /^\s+$/.test(seg.text.substring(0, offsetInText));
      if (!onlySkippedWhitespace) {
        return seg.start + newOffsetInText;
      }
    }
    // Reached start of text segment — continue to previous segment
    pos = seg.start;
  }

  // Check if we're exactly at a segment boundary
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    const segEnd = seg.start + (seg.type === 'text' ? seg.text.length : seg.token.length);
    if (segEnd !== pos) continue;

    // We're right at the end of this segment
    if (seg.type === 'chip') {
      return seg.start;
    }

    // At end of text segment — find word boundary within
    const newOffsetInText = findTextWordBoundaryLeft(seg.text, seg.text.length);
    if (newOffsetInText < seg.text.length) {
      const onlySkippedWhitespace = newOffsetInText === 0 && /^\s+$/.test(seg.text);
      if (!onlySkippedWhitespace) {
        return seg.start + newOffsetInText;
      }
    }
    // Continue to earlier segment
    pos = seg.start;
    // Re-check from previous segments
    for (let j = i - 1; j >= 0; j--) {
      const prevSeg = segments[j]!;
      const prevEnd =
        prevSeg.start + (prevSeg.type === 'text' ? prevSeg.text.length : prevSeg.token.length);
      if (prevEnd !== pos) continue;
      if (prevSeg.type === 'chip') {
        return prevSeg.start;
      }
      const prevOffset = findTextWordBoundaryLeft(prevSeg.text, prevSeg.text.length);
      if (prevOffset < prevSeg.text.length) {
        const prevOnlyWhitespace = prevOffset === 0 && /^\s+$/.test(prevSeg.text);
        if (!prevOnlyWhitespace) {
          return prevSeg.start + prevOffset;
        }
      }
      pos = prevSeg.start;
    }
    break;
  }

  return 0;
}

function findWordBoundaryRight(segments: Segment[], fromOffset: number): number {
  const totalLength =
    segments.length > 0
      ? (() => {
          const last = segments[segments.length - 1]!;
          return last.start + (last.type === 'text' ? last.text.length : last.token.length);
        })()
      : 0;

  let pos = fromOffset;

  // Find which segment we're currently in
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segEnd = seg.start + (seg.type === 'text' ? seg.text.length : seg.token.length);

    if (pos < seg.start) continue; // Not yet reached this segment
    if (pos >= segEnd) continue; // Past this segment

    // We're inside this segment
    if (seg.type === 'chip') {
      // Jump to after the chip
      return segEnd;
    }

    // Text segment — find next word boundary within the text
    const offsetInText = pos - seg.start;
    const newOffsetInText = findTextWordBoundaryRight(seg.text, offsetInText);
    if (newOffsetInText > offsetInText) {
      // If we landed at the end of the text segment and only consumed whitespace (no word chars),
      // continue scanning forward to skip an adjacent chip as part of the same word-skip.
      const onlySkippedWhitespace =
        newOffsetInText === seg.text.length &&
        /^\s+$/.test(seg.text.substring(offsetInText, newOffsetInText));
      if (!onlySkippedWhitespace) {
        return seg.start + newOffsetInText;
      }
    }
    // Reached end of text segment — continue to next segment
    pos = segEnd;
  }

  // Check if we're exactly at a segment boundary
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.start !== pos) continue;

    // We're right at the start of this segment
    if (seg.type === 'chip') {
      return seg.start + seg.token.length;
    }

    const newOffsetInText = findTextWordBoundaryRight(seg.text, 0);
    if (newOffsetInText > 0) {
      const onlySkippedWhitespace = newOffsetInText === seg.text.length && /^\s+$/.test(seg.text);
      if (!onlySkippedWhitespace) {
        return seg.start + newOffsetInText;
      }
    }
    // Continue to next segment
    pos = seg.start + seg.text.length;
    for (let j = i + 1; j < segments.length; j++) {
      const nextSeg = segments[j]!;
      if (nextSeg.start !== pos) continue;
      if (nextSeg.type === 'chip') {
        return nextSeg.start + nextSeg.token.length;
      }
      const nextOffset = findTextWordBoundaryRight(nextSeg.text, 0);
      if (nextOffset > 0) {
        const nextOnlyWhitespace = nextOffset === nextSeg.text.length && /^\s+$/.test(nextSeg.text);
        if (!nextOnlyWhitespace) {
          return nextSeg.start + nextOffset;
        }
      }
      pos = nextSeg.start + nextSeg.text.length;
    }
    break;
  }

  return totalLength;
}

// ── Internal: text word boundary helpers ─────────────────────────────────────

/** Standard word-skip left: skip whitespace then skip word characters. */
function findTextWordBoundaryLeft(text: string, offset: number): number {
  let pos = offset;

  // Skip whitespace/non-word chars to the left
  while (pos > 0 && /\s/.test(text[pos - 1]!)) {
    pos--;
  }

  // Skip word characters to the left
  while (pos > 0 && /\S/.test(text[pos - 1]!)) {
    pos--;
  }

  return pos;
}

/** Standard word-skip right: skip word characters then skip whitespace. */
function findTextWordBoundaryRight(text: string, offset: number): number {
  let pos = offset;

  // Skip word characters to the right
  while (pos < text.length && /\S/.test(text[pos]!)) {
    pos++;
  }

  // Skip whitespace to the right
  while (pos < text.length && /\s/.test(text[pos]!)) {
    pos++;
  }

  return pos;
}

// ── Internal: cursor positioning helpers ─────────────────────────────────────

function setCursorBeforeNode(node: Node): void {
  const parent = node.parentNode;
  if (!parent) return;
  const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(parent, index);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCursorAfterNode(node: Node): void {
  const parent = node.parentNode;
  if (!parent) return;
  const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(parent, index + 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getCurrentRawOffset(container: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

  const { anchorNode, anchorOffset } = selection;
  if (!anchorNode || !container.contains(anchorNode)) return null;

  return computeRawOffset(container, anchorNode, anchorOffset);
}
