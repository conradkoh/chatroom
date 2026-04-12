/**
 * Simplified serializer for contenteditable input.
 *
 * Converts between raw text and safe HTML for rendering inside
 * a contenteditable div. Handles HTML escaping and newlines.
 */

// ── rawTextToHtml ────────────────────────────────────────────────────────────

/**
 * Convert raw message text to HTML for rendering inside a contenteditable div.
 *
 * HTML-escapes the text and converts newlines to <br>.
 */
export function rawTextToHtml(text: string): string {
  if (!text) return '';
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ── htmlToRawText ────────────────────────────────────────────────────────────

/**
 * Convert HTML from a contenteditable div back to raw text.
 *
 * <br> becomes newline. Other HTML is stripped, text content is extracted.
 */
export function htmlToRawText(element: HTMLElement): string {
  let result = '';

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // <br> → newline
      if (el.tagName === 'BR') {
        result += '\n';
        continue;
      }

      // <div> is how contenteditable handles newlines in some browsers
      if (el.tagName === 'DIV') {
        // If this div is not the first child, prepend newline
        if (el.previousSibling) {
          result += '\n';
        }
        result += htmlToRawText(el);
        continue;
      }

      // Recurse into other elements
      result += htmlToRawText(el);
    }
  }

  return result;
}

// ── domOffsetToRawOffset ─────────────────────────────────────────────────────

/**
 * Compute the raw text cursor offset from a DOM selection within a contenteditable.
 *
 * Walks the DOM tree in document order, accumulating character counts:
 * - Text nodes contribute their textContent length
 * - <br> contributes 1 (newline)
 * - <div> contributes 1 (newline) if not the first child
 *
 * Returns the offset into the raw text string where the cursor is.
 */
export function domOffsetToRawOffset(
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
        offset += anchorOffset;
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
      offset += (node.textContent ?? '').length;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

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
      offset += (node.textContent ?? '').length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
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

// ── setCursorToRawOffset ─────────────────────────────────────────────────────

/**
 * Set the cursor to a specific raw text offset within a contenteditable element.
 *
 * Walks the DOM tree mapping raw text offsets to DOM positions, then sets the
 * selection using the Range API.
 */
export function setCursorToRawOffset(container: HTMLElement, targetOffset: number): void {
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

      if (el.tagName === 'DIV' && el.previousSibling) {
        if (remaining <= 1) {
          // Place at the beginning of this div
          targetNode = el;
          targetDomOffset = 0;
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

// ── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
