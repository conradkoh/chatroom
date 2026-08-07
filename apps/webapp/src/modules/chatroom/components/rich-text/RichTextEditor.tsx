'use client';

import { EditorContent } from '@tiptap/react';

import { backlogRichTextEditorProseClassNames } from '../markdown-utils';
import { RichTextToolbar } from './RichTextToolbar';
import { useRichTextEditor } from './useRichTextEditor';

import { cn } from '@/lib/utils';

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: string;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  className?: string;
  /** Viewport coords from click-to-edit; caret placed via posAtCoords on mount. */
  initialClickCoords?: { left: number; top: number } | null;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight,
  autoFocus,
  onCmdEnter,
  className,
  initialClickCoords,
}: RichTextEditorProps) {
  const { editor } = useRichTextEditor({
    content: value,
    onUpdate: onChange,
    placeholder,
    autoFocus: initialClickCoords ? false : autoFocus,
    onCmdEnter,
    initialClickCoords,
  });

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <RichTextToolbar editor={editor} />
      <div
        className="flex-1 min-h-0 cursor-text overflow-y-auto outline-none focus:outline-none focus-visible:outline-none"
        style={minHeight ? { minHeight } : undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            editor?.chain().focus().run();
          }
        }}
      >
        <EditorContent
          editor={editor}
          className={cn(
            'flex flex-col flex-1 min-h-0 p-4 min-w-0 overflow-x-hidden outline-none focus:outline-none focus-visible:outline-none',
            '[&_.tiptap]:flex-1 [&_.tiptap]:min-h-full',
            '[&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none [&_.ProseMirror-focused]:outline-none',
            backlogRichTextEditorProseClassNames
          )}
        />
      </div>
    </div>
  );
}
