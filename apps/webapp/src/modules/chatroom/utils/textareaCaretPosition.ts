/**
 * Returns caret position relative to anchor element, for autocomplete dropdown placement.
 * Uses mirror div technique to measure cursor pixel offset.
 * @deprecated Use {@link getTextareaCaretViewportOffset} for portaled/fixed dropdowns.
 */
// fallow-ignore-next-line unused-export
export function getTextareaCaretOffsetInContainer(
  textarea: HTMLTextAreaElement,
  anchor: HTMLElement
): { top: number; left: number; height: number } | null {
  const measured = measureTextareaCaret(textarea);
  if (!measured) return null;
  const anchorRect = anchor.getBoundingClientRect();
  return {
    top:
      measured.caretRect.top - measured.mirrorRect.top + measured.textareaRect.top - anchorRect.top,
    left:
      measured.caretRect.left -
      measured.mirrorRect.left +
      measured.textareaRect.left -
      anchorRect.left,
    height: measured.caretRect.height,
  };
}

/**
 * Returns caret position in viewport coordinates, for `position: fixed` dropdowns
 * rendered via a portal (escapes the composer's glassmorphism stacking context).
 * Uses the same mirror-div technique as {@link getTextareaCaretOffsetInContainer}.
 */
export function getTextareaCaretViewportOffset(
  textarea: HTMLTextAreaElement
): { top: number; left: number; height: number } | null {
  const measured = measureTextareaCaret(textarea);
  if (!measured) return null;
  return {
    top: measured.caretRect.top - measured.mirrorRect.top + measured.textareaRect.top,
    left: measured.caretRect.left - measured.mirrorRect.left + measured.textareaRect.left,
    height: measured.caretRect.height,
  };
}

/**
 * Measures the textarea caret using a hidden mirror div that mimics the
 * textarea's text layout. Returns viewport-relative rects so callers can
 * compute either anchor-relative or viewport coordinates.
 */
function measureTextareaCaret(
  textarea: HTMLTextAreaElement
): { caretRect: DOMRect; mirrorRect: DOMRect; textareaRect: DOMRect } | null {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = style.width;
  mirror.style.font = style.font;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;

  const textBeforeCursor = textarea.value.substring(0, textarea.selectionStart);
  mirror.innerHTML =
    textBeforeCursor.replace(/\n$/, '\n\u00A0').replace(/\n/g, '<br>') +
    '<span id="caret">|</span>';

  document.body.appendChild(mirror);
  const caretSpan = mirror.querySelector('#caret');
  if (!caretSpan) {
    document.body.removeChild(mirror);
    return null;
  }

  const caretRect = caretSpan.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  document.body.removeChild(mirror);

  return { caretRect, mirrorRect, textareaRect };
}
