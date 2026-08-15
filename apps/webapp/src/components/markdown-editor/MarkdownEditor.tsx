'use client';

import { EditorContent } from '@tiptap/react';

import { MarkdownToolbar } from './MarkdownToolbar';
import type { MarkdownEditorProps } from './types';
import { useMarkdownEditor } from './useMarkdownEditor';

import { cn } from '@/lib/utils';

// fallow-ignore-next-line complexity
export function MarkdownEditor({
  defaultMarkdown = '',
  onChange,
  className,
  proseClassName,
  normalizeContent,
  placeholder,
  autoFocus,
  onCmdEnter,
  initialClickCoords,
  fillHeight = false,
}: MarkdownEditorProps) {
  const { editor } = useMarkdownEditor({
    content: defaultMarkdown,
    onUpdate: (md) => onChange?.(md),
    placeholder,
    autoFocus,
    onCmdEnter,
    initialClickCoords,
    normalizeContent,
  });

  const focusEditorAtEnd = () => {
    editor?.chain().focus('end').run();
  };

  return (
    <div
      data-testid="markdown-editor"
      className={cn(
        'rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0',
        fillHeight && 'h-full',
        className
      )}
    >
      <MarkdownToolbar editor={editor} normalizeContent={normalizeContent} />
      {/*
       * TipTap full-height pitfall: ProseMirror height follows content unless fillHeight
       * stretches .tiptap/.ProseMirror via min-h-full in a flex column chain.
       * Parent must pass flex-1 min-h-0 (see ChatroomModalMarkdownEditor).
       */}
      <div
        className={cn('flex-1 min-h-0 cursor-text overflow-y-auto', fillHeight && 'flex flex-col')}
        style={fillHeight ? undefined : { minHeight: '200px' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            focusEditorAtEnd();
          }
        }}
      >
        <EditorContent
          editor={editor}
          className={cn(
            'p-4 min-w-0 outline-none',
            fillHeight
              ? 'flex flex-1 flex-col min-h-0 [&_.tiptap]:flex-1 [&_.tiptap]:min-h-full [&_.ProseMirror]:min-h-full'
              : '[&_.tiptap]:min-h-[200px]',
            '[&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none',
            proseClassName
          )}
        />
      </div>
    </div>
  );
}
