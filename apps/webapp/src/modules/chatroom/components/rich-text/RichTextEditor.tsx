'use client';

import { EditorContent } from '@tiptap/react';

import { RichTextToolbar } from './RichTextToolbar';
import { useRichTextEditor } from './useRichTextEditor';

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: string;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = '260px',
  autoFocus,
  onCmdEnter,
  className,
}: RichTextEditorProps) {
  const { editor } = useRichTextEditor({
    content: value,
    onUpdate: onChange,
    placeholder,
    autoFocus,
  });

  return (
    <div className={className}>
      <RichTextToolbar editor={editor} />
      <div
        className="overflow-y-auto outline-none focus:outline-none focus-visible:outline-none"
        style={{ minHeight }}
        onClick={() => editor?.chain().focus().run()}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onCmdEnter?.();
          }
        }}
      >
        <EditorContent
          editor={editor}
          className="p-4 text-sm outline-none focus:outline-none focus-visible:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none [&_.ProseMirror-focused]:outline-none"
        />
      </div>
    </div>
  );
}
