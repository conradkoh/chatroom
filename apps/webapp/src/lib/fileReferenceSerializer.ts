import { decodeFileReferences } from './fileReference';
import { getFileName } from './pathUtils';
import { buildFileRefChipHtml } from '@/modules/chatroom/components/FileReferenceChipUI';
import { ZWS, stripZws, computeRawOffset } from './domOffsetUtils';

// Re-export shared utilities so existing consumers don't break
export { ZWS, stripZws };

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
 *
 * A ZWS (zero-width space) is inserted before chips that appear at the start
 * of a line (beginning of content or right after <br>). This gives Safari a
 * text node where it can position the caret before the chip.
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

    // Insert ZWS before chip if it's at the very beginning of the output.
    // This allows Safari to position the caret before the first chip.
    // Note: we do NOT insert ZWS after <br> because it renders as a visible
    // blank line, causing a double-newline visual artifact.
    const chipAtContainerStart = html.length === 0;
    if (chipAtContainerStart) {
      html += ZWS;
    }

    // The chip span (non-editable, atomic for caret navigation)
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
      result += stripZws(node.textContent ?? '');
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
 * Delegates to the shared computeRawOffset from domOffsetUtils.
 * This wrapper preserves the public API name used by existing consumers.
 */
export function domOffsetToRawOffset(
  container: HTMLElement,
  anchorNode: Node,
  anchorOffset: number
): number {
  return computeRawOffset(container, anchorNode, anchorOffset);
}

/**
 * Set the cursor to a specific raw text offset within a contenteditable element.
 *
 * Delegates to the shared setCursorToRawOffset from domOffsetUtils.
 * Re-exported here to preserve the existing public API.
 */
export { setCursorToRawOffset } from './domOffsetUtils';

/**
 * Extract raw text (with {file://...} tokens) from the current DOM selection
 * within a contenteditable container.
 *
 * Returns null if there is no selection or the selection is not within the container.
 * The returned string uses the same raw token format as `htmlToRawText`.
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
 * Uses the same logic as htmlToRawText but works on a fragment.
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
 * Shared helper for fragment-based extraction.
 */
function nodeToRawText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return stripZws(node.textContent ?? '');
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;

    // Check if it's a file reference chip
    const fileRef = el.getAttribute('data-file-ref');
    if (fileRef) {
      return fileRef;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
