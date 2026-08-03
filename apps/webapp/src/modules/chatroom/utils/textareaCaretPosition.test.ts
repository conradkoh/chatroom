import { afterEach, describe, expect, it } from 'vitest';

import { getTextareaCaretViewportOffset } from './textareaCaretPosition';

function createTextarea(value = 'hello @world', selectionStart = 6): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setSelectionRange(selectionStart, selectionStart);
  document.body.appendChild(textarea);
  return textarea;
}

describe('getTextareaCaretViewportOffset', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns viewport caret coordinates for a textarea', () => {
    const textarea = createTextarea();
    const result = getTextareaCaretViewportOffset(textarea);

    expect(result).not.toBeNull();
    expect(typeof result?.top).toBe('number');
    expect(typeof result?.left).toBe('number');
    expect(typeof result?.height).toBe('number');
    textarea.remove();
  });

  it('does not leak the temporary mirror div into the DOM', () => {
    const textarea = createTextarea();
    const divsBefore = document.querySelectorAll('div').length;

    getTextareaCaretViewportOffset(textarea);

    expect(document.querySelectorAll('div').length).toBe(divsBefore);
    textarea.remove();
  });
});
