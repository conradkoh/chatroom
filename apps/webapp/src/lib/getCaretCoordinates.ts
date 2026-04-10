/**
 * Get pixel coordinates of a cursor position within a textarea.
 * Uses a mirror div technique: creates a hidden div that replicates the textarea's
 * text styles and content up to the cursor, then measures the resulting position.
 *
 * Returns { top, left, height } relative to the textarea element.
 */
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number; height: number } {
  // Properties to copy from the textarea to the mirror div
  const properties = [
    'direction',
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderStyle',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'MozTabSize',
    'whiteSpace',
    'wordWrap',
    'wordBreak',
  ] as const;

  const div = document.createElement('div');
  div.id = 'caret-position-mirror';
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(textarea);

  // Position off-screen
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  // Copy textarea styles
  for (const prop of properties) {
    style.setProperty(prop, computed.getPropertyValue(prop));
  }

  // Set fixed width to match textarea
  style.width = `${textarea.offsetWidth}px`;
  style.overflow = 'hidden';

  // Insert text up to cursor, then a span marker
  const textBeforeCursor = textarea.value.substring(0, position);
  const textNode = document.createTextNode(textBeforeCursor);
  div.appendChild(textNode);

  const span = document.createElement('span');
  // Use a zero-width space so the span has height
  span.textContent = '\u200b';
  div.appendChild(span);

  const coordinates = {
    top: span.offsetTop - textarea.scrollTop,
    left: span.offsetLeft,
    height: span.offsetHeight,
  };

  document.body.removeChild(div);

  return coordinates;
}
