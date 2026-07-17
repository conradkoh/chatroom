/**
 * Returns caret position relative to anchor element, for autocomplete dropdown placement.
 * Uses mirror div technique to measure cursor pixel offset.
 */
export function getTextareaCaretOffsetInContainer(
  textarea: HTMLTextAreaElement,
  anchor: HTMLElement
): { top: number; left: number; height: number } | null {
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

  const textareaRect = textarea.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const caretRect = caretSpan.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: caretRect.top - mirrorRect.top + textareaRect.top - anchorRect.top,
    left: caretRect.left - mirrorRect.left + textareaRect.left - anchorRect.left,
    height: caretRect.height,
  };
}
