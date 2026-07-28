import { describe, expect, it, vi } from 'vitest';

import { handleRichTextModEnter } from './handleRichTextModEnter';

describe('handleRichTextModEnter', () => {
  it('Meta+Enter calls onCmdEnter once and returns true', () => {
    const onCmdEnter = vi.fn();
    const result = handleRichTextModEnter(
      { key: 'Enter', metaKey: true, ctrlKey: false },
      onCmdEnter
    );
    expect(result).toBe(true);
    expect(onCmdEnter).toHaveBeenCalledTimes(1);
  });

  it('Plain Enter does NOT call onCmdEnter and returns false', () => {
    const onCmdEnter = vi.fn();
    const result = handleRichTextModEnter(
      { key: 'Enter', metaKey: false, ctrlKey: false },
      onCmdEnter
    );
    expect(result).toBe(false);
    expect(onCmdEnter).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter calls onCmdEnter and returns true', () => {
    const onCmdEnter = vi.fn();
    const result = handleRichTextModEnter(
      { key: 'Enter', metaKey: false, ctrlKey: true },
      onCmdEnter
    );
    expect(result).toBe(true);
    expect(onCmdEnter).toHaveBeenCalledTimes(1);
  });

  it('does nothing when onCmdEnter is not provided', () => {
    const result = handleRichTextModEnter(
      { key: 'Enter', metaKey: true, ctrlKey: false },
      undefined
    );
    expect(result).toBe(false);
  });
});
