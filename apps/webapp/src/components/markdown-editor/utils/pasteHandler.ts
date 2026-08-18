import type { Editor } from '@tiptap/react';

/** Returns false when ProseMirror should handle paste as literal text in code. */
// fallow-ignore-next-line complexity
export function shouldInterceptPasteForMarkdownConversion(
  editor: Editor | null | undefined
): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (editor.isActive('codeBlock') || editor.isActive('code')) return false;
  return true;
}
