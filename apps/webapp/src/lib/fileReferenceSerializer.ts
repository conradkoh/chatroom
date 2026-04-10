import { decodeFileReferences } from './fileReference';
import { getFileName } from './pathUtils';
import { buildFileRefChipHtml } from '@/modules/chatroom/components/FileReferenceChipUI';

/**
 * Convert raw message text (with {file://workspace/path} tokens) to HTML
 * for rendering inside a contenteditable div.
 *
 * File references become non-editable chip spans:
 * <span contenteditable="false" data-file-ref="{file://workspace/path}" class="...">
 *   filename.ts
 * </span>
 *
 * Regular text is HTML-escaped. Newlines become <br>.
 */
export function rawTextToHtml(text: string): string {
  if (!text) return '';

  const refs = decodeFileReferences(text);
  if (refs.length === 0) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  let html = '';
  let lastEnd = 0;

  for (const ref of refs) {
    // Text before this reference
    const before = text.slice(lastEnd, ref.start);
    html += escapeHtml(before).replace(/\n/g, '<br>');

    // The chip span
    const rawToken = text.slice(ref.start, ref.end);
    const fileName = getFileName(ref.filePath);
    html += buildChipHtml(rawToken, fileName);

    lastEnd = ref.end;
  }

  // Text after the last reference
  const after = text.slice(lastEnd);
  html += escapeHtml(after).replace(/\n/g, '<br>');

  return html;
}

/**
 * Build the HTML for a single file reference chip.
 * Delegates to the shared buildFileRefChipHtml for unified styling.
 * The chip is non-editable so the browser treats it as an atomic unit
 * (backspace deletes the whole thing).
 */
function buildChipHtml(rawToken: string, fileName: string): string {
  return buildFileRefChipHtml(rawToken, fileName);
}

/**
 * Convert HTML from a contenteditable div back to raw text.
 *
 * Chip spans (with data-file-ref) are converted back to their raw token.
 * <br> becomes newline. Other HTML is stripped.
 */
export function htmlToRawText(element: HTMLElement): string {
  let result = '';

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // Check if it's a file reference chip
      const fileRef = el.getAttribute('data-file-ref');
      if (fileRef) {
        result += fileRef;
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

/**
 * Compute the raw text cursor offset from a DOM selection within a contenteditable.
 *
 * Walks the DOM tree in document order, accumulating character counts:
 * - Text nodes contribute their textContent length
 * - Chip spans (data-file-ref) contribute the length of their raw token
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
      offset += node.textContent?.length ?? 0;
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
      offset += node.textContent?.length ?? 0;
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
      const len = node.textContent?.length ?? 0;
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
        if (remaining <= fileRef.length) {
          // Place cursor after the chip
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
