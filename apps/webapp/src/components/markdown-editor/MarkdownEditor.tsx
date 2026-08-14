'use client';

import { EditorContent } from '@tiptap/react';

import { MarkdownToolbar } from './MarkdownToolbar';
import type { MarkdownEditorProps } from './types';
import { useMarkdownEditor } from './useMarkdownEditor';

import { cn } from '@/lib/utils';

export function MarkdownEditor({
  defaultMarkdown = '',
  onChange,
  className,
  placeholder,
  autoFocus,
}: MarkdownEditorProps) {
  const { editor } = useMarkdownEditor({
    content: defaultMarkdown,
    onUpdate: (md) => onChange?.(md),
    placeholder,
    autoFocus,
  });

  return (
    <div data-testid="markdown-editor" className={cn('rounded-lg border border-border bg-card overflow-hidden flex flex-col min-h-0', className)}>
      <MarkdownToolbar editor={editor} />
      <div className="flex-1 min-h-0 cursor-text overflow-y-auto" style={{ minHeight: '200px' }} onClick={(e) => { if (e.target === e.currentTarget) editor?.chain().focus().run(); }}>
        <EditorContent editor={editor} className={cn('p-4 min-w-0 outline-none', '[&_.tiptap]:min-h-[200px]', '[&_.ProseMirror]:outline-none [&_.ProseMirror:focus]:outline-none', 'prose dark:prose-invert max-w-none')} />
      </div>
    </div>
  );
}
