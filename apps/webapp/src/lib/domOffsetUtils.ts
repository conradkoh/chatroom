/**
 * Shared DOM-walking utilities for contenteditable elements with file reference chips.
 *
 * This module provides the core logic for mapping between raw text offsets (ZWS-free)
 * and DOM positions within a contenteditable container. It's used by both the
 * fileReferenceSerializer (for cursor restoration after re-rendering) and
 * chipNavigation (for keyboard navigation around chips).
 *
 * Key concepts:
 * - "Raw offset" = character position in the logical text (no ZWS characters)
 * - "DOM offset" = position within the DOM tree (includes ZWS characters in text nodes)
 * - Chip spans (data-file-ref) count as their raw token length in raw offsets
 * - <br> elements count as 1 character (newline)
 */

// ── ZWS helpers ──────────────────────────────────────────────────────────────

/**
 * Zero-width space character used before chips at line start positions.
 * Gives Safari a text node to place the caret before the chip, preventing
 * caret-overlap issues in contenteditable elements.
 */
export const ZWS = '\u200B';

/**
 * Strip all ZWS characters from a string.
 * Used when converting DOM text content back to raw text.
 */
export function stripZws(text: string): string {
  return text.replace(/\u200B/g, '');
}

// ── Raw ↔ DOM offset mapping ─────────────────────────────────────────────────

/**
 * Map a raw text offset (ZWS-free) to a DOM offset within a text node
 * that may contain ZWS characters. Skips over ZWS chars when counting.
 *
 * Example: text = "\u200Bhello", rawOffset = 2 → domOffset = 3
 * (skip the ZWS at position 0, then count 'h' at 1, 'e' at 2 → DOM position 3)
 */
export function rawToDomOffset(text: string, rawOffset: number): number {
  let rawCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ZWS) continue;
    if (rawCount === rawOffset) return i;
    rawCount++;
  }
  return text.length;
}

// ── DOM position → raw offset ────────────────────────────────────────────────

/**
 * Compute the raw text cursor offset from a DOM selection position within a contenteditable.
 *
 * Walks the DOM tree in document order, accumulating character counts:
 * - Text nodes contribute their textContent length (minus ZWS)
 * - Chip spans (data-file-ref) contribute the length of their raw token
 * - <br> contributes 1 (newline)
 * - <div> contributes 1 (newline) if not the first child
 *
 * Returns the offset into the raw text string where the cursor is.
 */
export function computeRawOffset(
  container: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): number {
  let offset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;

    if (node === anchorNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        // Count only non-ZWS chars up to anchorOffset
        const text = node.textContent ?? '';
        const beforeCursor = text.slice(0, anchorOffset);
        offset += stripZws(beforeCursor).length;
      } else {
        // Element node — anchorOffset is the child index
        for (let i = 0; i < anchorOffset && i < node.childNodes.length; i++) {
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

      // Chip span — count the raw token length as a whole
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        // If the anchor is inside the chip, treat it as being at the end
        if (el.contains(anchorNode)) {
          offset += fileRef.length;
          found = true;
          return true;
        }
        offset += fileRef.length;
        return false;
      }

      // <br> → 1 character
      if (el.tagName === 'BR') {
        offset += 1;
        return false;
      }

      // <div> newline (contenteditable line break behavior)
      if (el.tagName === 'DIV' && el.previousSibling) {
        offset += 1;
      }

      // Recurse into children
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }

    return false;
  }

  /** Accumulate the full raw text length of a node subtree. */
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
      if (el.tagName === 'BR') {
        offset += 1;
        return;
      }
      if (el.tagName === 'DIV' && el.previousSibling) {
        offset += 1;
      }
      for (const child of Array.from(el.childNodes)) {
        accumulateLength(child);
      }
    }
  }

  walk(container);
  return offset;
}

// ── Raw offset → DOM position ────────────────────────────────────────────────

/**
 * Resolve a raw offset into a DOM (node, offset) pair.
 * Returns the node and offset suitable for Range/Selection APIs.
 *
 * When the target offset falls exactly at a chip boundary (remaining === 0),
 * the cursor is placed before the chip. When it falls within the chip's token
 * range (0 < remaining <= tokenLength), the cursor is placed after the chip.
 */
export function resolveRawOffsetToDom(
  container: HTMLElement,
  targetOffset: number
): { node: Node; offset: number } {
  let remaining = targetOffset;
  let resultNode: Node = container;
  let resultOffset = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (found) return true;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const rawLen = stripZws(text).length;
      if (remaining <= rawLen) {
        resultNode = node;
        resultOffset = rawToDomOffset(text, remaining);
        found = true;
        return true;
      }
      remaining -= rawLen;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        if (remaining === 0) {
          // Place cursor before the chip
          resultNode = el.parentNode!;
          resultOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el);
          found = true;
          return true;
        }
        if (remaining <= fileRef.length) {
          // Place cursor after the chip
          resultNode = el.parentNode!;
          resultOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el) + 1;
          found = true;
          return true;
        }
        remaining -= fileRef.length;
        return false;
      }

      if (el.tagName === 'BR') {
        if (remaining <= 1) {
          resultNode = el.parentNode!;
          resultOffset = Array.from(el.parentNode?.childNodes ?? []).indexOf(el) + 1;
          found = true;
          return true;
        }
        remaining -= 1;
        return false;
      }

      // <div> newline (contenteditable line break behavior)
      if (el.tagName === 'DIV' && el.previousSibling) {
        if (remaining <= 1) {
          // Place at the beginning of this div
          resultNode = el;
          resultOffset = 0;
          found = true;
          return true;
        }
        remaining -= 1;
      }

      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }
    return false;
  }

  walk(container);

  if (!found) {
    // Past end — position at end of container
    resultNode = container;
    resultOffset = container.childNodes.length;
  }

  return { node: resultNode, offset: resultOffset };
}

// ── Cursor positioning ───────────────────────────────────────────────────────

/**
 * Set the cursor to a specific raw text offset within a contenteditable element.
 *
 * Resolves the raw offset to a DOM position, then sets the selection using
 * the Range API.
 */
export function setCursorToRawOffset(container: HTMLElement, targetOffset: number): void {
  const { node: targetNode, offset: targetDomOffset } = resolveRawOffsetToDom(
    container,
    targetOffset
  );

  // resolveRawOffsetToDom always returns a valid node (falls back to container end)
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.setStart(targetNode, targetDomOffset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
