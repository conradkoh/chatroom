import { describe, expect, it } from 'vitest';

import { shouldRefocusMessageInput } from './shouldRefocusMessageInput';

describe('shouldRefocusMessageInput', () => {
  it('returns false when document is hidden', () => {
    expect(
      shouldRefocusMessageInput({
        documentHidden: true,
        activeCommandDialog: null,
        activeElement: null,
      })
    ).toBe(false);
  });

  it('returns false when command dialog is open', () => {
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: 'command-palette',
        activeElement: null,
      })
    ).toBe(false);
  });

  it('returns false when focus is in a non-message textarea', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: null,
        activeElement: textarea,
      })
    ).toBe(false);
    document.body.removeChild(textarea);
  });

  it('returns true when focus is in the message input textarea', () => {
    const container = document.createElement('div');
    container.setAttribute('data-message-input', '');
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    document.body.appendChild(container);
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: null,
        activeElement: textarea,
      })
    ).toBe(true);
    document.body.removeChild(container);
  });

  it('returns false when focus is inside a dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: null,
        activeElement: input,
      })
    ).toBe(false);
    document.body.removeChild(dialog);
  });

  it('returns false when an open dialog exists in the DOM', () => {
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: null,
        activeElement: null,
        hasOpenDialogInDom: true,
      })
    ).toBe(false);
  });

  it('returns true when tab is visible and no blockers', () => {
    expect(
      shouldRefocusMessageInput({
        documentHidden: false,
        activeCommandDialog: null,
        activeElement: null,
      })
    ).toBe(true);
  });
});
