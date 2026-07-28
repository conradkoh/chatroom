import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||
    /^```/m.test(text) ||
    /^\s*[-*+]\s/m.test(text) ||
    /^\s*\d+\.\s/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /`[^`]+`/.test(text)
  );
}

export const PasteMarkdown = Extension.create({
  name: 'pasteMarkdown',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const text = event.clipboardData?.getData('text/plain');
            if (!text || !looksLikeMarkdown(text)) return false;

            editor.commands.insertContent(text, { contentType: 'markdown' });
            return true;
          },
        },
      }),
    ];
  },
});
