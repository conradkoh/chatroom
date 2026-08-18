import type { Editor } from '@tiptap/react';
import { describe, expect, it } from 'vitest';

import { shouldInterceptPasteForMarkdownConversion } from './pasteHandler';

function editor(isActive: (name: string) => boolean, isDestroyed = false) {
  return { isActive, isDestroyed } as unknown as Editor;
}

describe('shouldInterceptPasteForMarkdownConversion', () => {
  it('does not intercept paste inside a fenced code block', () => {
    expect(shouldInterceptPasteForMarkdownConversion(editor((name) => name === 'codeBlock'))).toBe(
      false
    );
  });

  it('does not intercept paste inside inline code', () => {
    expect(shouldInterceptPasteForMarkdownConversion(editor((name) => name === 'code'))).toBe(
      false
    );
  });

  it('intercepts paste outside code', () => {
    expect(shouldInterceptPasteForMarkdownConversion(editor(() => false))).toBe(true);
  });

  it('does not intercept missing or destroyed editors', () => {
    expect(shouldInterceptPasteForMarkdownConversion(null)).toBe(false);
    expect(shouldInterceptPasteForMarkdownConversion(editor(() => false, true))).toBe(false);
  });
});
