/**
 * Simplified file reference serializer for contenteditable input.
 *
 * Converts between raw text (with file reference tokens) and
 * safe HTML for rendering inside a contenteditable div.
 *
 * When a prefix is provided, file reference tokens are rendered as atomic
 * (non-editable) inline spans showing just the file path.
 */

import { decodeFileReferences } from './fileReference';

// ── rawTextToHtml ────────────────────────────────────────────────────────────

/**
 * Convert raw message text to HTML for rendering inside a contenteditable div.
 *
 * HTML-escapes the text and converts newlines to <br>.
 *
 * If a prefix is provided, file reference tokens matching that prefix are
 * rendered as atomic inline spans with `data-token` containing the full
 * internal token and the visible text showing just the file path.
 */
export function rawTextToHtml(text: string, prefix?: string): string {
  if (!text) return '';

  if (!prefix) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  const refs = decodeFileReferences(text, prefix);
  if (refs.length === 0) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  let result = '';
  let cursor = 0;

  for (const ref of refs) {
    // Add escaped text before this token
    result += escapeHtml(text.slice(cursor, ref.start)).replace(/\n/g, '<br>');

    // Add atomic span for the token
    const fullToken = text.slice(ref.start, ref.end);
    result += `<span data-token="${escapeHtmlAttr(fullToken)}" contenteditable="false" class="file-ref-inline">${escapeHtml(ref.filePath)}</span>`;

    cursor = ref.end;
  }

  // Add remaining text after last token
  result += escapeHtml(text.slice(cursor)).replace(/\n/g, '<br>');
  return result;
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

      // Token span → emit the full internal token from data-token
      if (isTokenSpan(el)) {
        result += getTokenValue(el);
        continue;
      }

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

      // Token span — count as the full internal token length
      if (isTokenSpan(el)) {
        // If anchorNode is inside this span, clamp to span boundaries
        if (el.contains(anchorNode)) {
          // Cursor is inside the atomic span — clamp to end
          offset += getTokenValue(el).length;
          found = true;
          return true;
        }
        offset += getTokenValue(el).length;
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
      offset += (node.textContent ?? '').length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      // Token span — count as full internal token length
      if (isTokenSpan(el)) {
        offset += getTokenValue(el).length;
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

      // Token span — its raw text length is the full internal token
      if (isTokenSpan(el)) {
        const tokenLen = getTokenValue(el).length;
        if (remaining <= tokenLen) {
          // Position cursor before or after the span
          const parent = el.parentNode;
          if (parent) {
            const idx = Array.from(parent.childNodes).indexOf(el);
            if (remaining <= tokenLen / 2) {
              // Closer to start — place cursor before span
              targetNode = parent;
              targetDomOffset = idx;
            } else {
              // Closer to end — place cursor after span
              targetNode = parent;
              targetDomOffset = idx + 1;
            }
            found = true;
            return true;
          }
        }
        remaining -= tokenLen;
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

// ── extractRawTextFromSelection ──────────────────────────────────────────────

/**
 * Extract raw text from the current DOM selection within a contenteditable container.
 *
 * Returns null if there is no selection or the selection is not within the container.
 */
export function extractRawTextFromSelection(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);

  // Verify the selection is within the container
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const fragment = range.cloneContents();
  return fragmentToRawText(fragment);
}

/**
 * Convert a DocumentFragment (from range.cloneContents()) to raw text.
 */
function fragmentToRawText(fragment: DocumentFragment): string {
  let result = '';

  for (const node of Array.from(fragment.childNodes)) {
    result += nodeToRawText(node);
  }

  return result;
}

/**
 * Convert a single DOM node to raw text recursively.
 */
function nodeToRawText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;

    // Token span → emit full internal token from data-token
    if (isTokenSpan(el)) {
      return getTokenValue(el);
    }

    // <br> → newline
    if (el.tagName === 'BR') {
      return '\n';
    }

    // <div> is how contenteditable handles newlines in some browsers
    if (el.tagName === 'DIV') {
      let text = '';
      if (el.previousSibling) {
        text += '\n';
      }
      for (const child of Array.from(el.childNodes)) {
        text += nodeToRawText(child);
      }
      return text;
    }

    // Recurse into other elements
    let text = '';
    for (const child of Array.from(el.childNodes)) {
      text += nodeToRawText(child);
    }
    return text;
  }

  return '';
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a string for use in an HTML attribute value (double-quoted). */
function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

/** Check if a DOM node is a token span (span with data-token attribute). */
export function isTokenSpan(node: Node | null | undefined): boolean {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName === 'SPAN' &&
    (node as HTMLElement).hasAttribute('data-token')
  );
}

/** Get the data-token value from a token span. */
function getTokenValue(el: HTMLElement): string {
  return el.getAttribute('data-token') ?? '';
}
