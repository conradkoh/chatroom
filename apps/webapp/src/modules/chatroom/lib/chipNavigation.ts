/**
 * Custom keyboard navigation for file reference chips in a contenteditable element.
 *
 * Chips are `<span contenteditable="false" data-file-ref="...">` elements that the
 * browser treats as atomic inline blocks. This module intercepts arrow key events
 * to provide deterministic cursor behavior around those chips:
 *
 * - **Left/Right Arrow**: skip over a chip as a unit when the cursor is adjacent to it
 * - **Alt+Arrow** (macOS word-skip): treat each chip as a "word" boundary
 *
 * NOTE: Windows/Linux use Ctrl+Arrow for word-skip. Only Alt+Arrow is handled here.
 * A future change could add Ctrl+Arrow support if needed.
 */

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
    if (direction === 'after' && anchorOffset === text.length) {
      // At the end of a text node — check if next sibling is a chip
      const next = anchorNode.nextSibling;
      if (next && isChipNode(next)) return next;
    }
    if (direction === 'before' && anchorOffset === 0) {
      // At the start of a text node — check if previous sibling is a chip
      const prev = anchorNode.previousSibling;
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
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;

  // Don't intercept selection-extending (Shift+Arrow)
  if (e.shiftKey) return false;

  const isAlt = e.altKey;
  // NOTE: e.metaKey (Cmd on macOS) + Arrow moves to line start/end — let browser handle
  if (e.metaKey) return false;

  if (isAlt) {
    return handleWordSkip(container, e.key === 'ArrowLeft' ? 'left' : 'right');
  }

  return handleSingleStep(container, e.key === 'ArrowLeft' ? 'left' : 'right');
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

  setCursorToRawOffsetInContainer(container, targetOffset);
  return true;
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
      const text = node.textContent ?? '';
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

  // Use domOffsetToRawOffset logic inline to avoid circular dependency
  return computeRawOffset(container, anchorNode, anchorOffset);
}

/**
 * Compute raw offset from DOM position. Mirrors domOffsetToRawOffset from the serializer
 * but kept here to avoid coupling with the serializer module.
 */
function computeRawOffset(container: HTMLElement, anchorNode: Node, anchorOffset: number): number {
  let offset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;

    if (node === anchorNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += anchorOffset;
      } else {
        for (let i = 0; i < anchorOffset && i < node.childNodes.length; i++) {
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
        if (el.contains(anchorNode)) {
          offset += fileRef.length;
          found = true;
          return true;
        }
        offset += fileRef.length;
        return false;
      }
      if (el.tagName === 'BR') {
        offset += 1;
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
      if (el.tagName === 'BR') {
        offset += 1;
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
 * Set the cursor to a raw offset within the container using the Range API.
 * Walks child nodes to find the target DOM position.
 */
function setCursorToRawOffsetInContainer(container: HTMLElement, targetOffset: number): void {
  let remaining = targetOffset;
  let targetNode: Node | null = null;
  let targetDomOffset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        targetNode = node;
        targetDomOffset = remaining;
        found = true;
        return true;
      }
      remaining -= len;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        if (remaining === 0) {
          // Place cursor before the chip
          targetNode = el.parentNode;
          targetDomOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el);
          found = true;
          return true;
        }
        if (remaining <= fileRef.length) {
          // Place cursor after the chip (cursor is within the chip's raw token range)
          targetNode = el.parentNode;
          targetDomOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el) + 1;
          found = true;
          return true;
        }
        remaining -= fileRef.length;
        return false;
      }
      if (el.tagName === 'BR') {
        if (remaining <= 1) {
          targetNode = el.parentNode;
          targetDomOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el) + 1;
          found = true;
          return true;
        }
        remaining -= 1;
        return false;
      }
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }
    return false;
  }

  walk(container);

  if (targetNode) {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.setStart(targetNode, targetDomOffset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}
