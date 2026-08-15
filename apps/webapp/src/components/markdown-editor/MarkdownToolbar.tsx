'use client';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Check,
  Code,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
} from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { getNormalizedEditorMarkdown } from './getNormalizedEditorMarkdown';
import type { MarkdownContentNormalizer } from './types';

const toolbarButtonClass =
  'flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors outline-none focus:outline-none focus-visible:outline-none';
const activeButtonClass = 'bg-muted text-foreground';
export function MarkdownToolbar({ editor, normalizeContent }: { editor: Editor | null; normalizeContent?: MarkdownContentNormalizer }) {
  const [copied, setCopied] = useState(false);
  const copyMarkdown = useCallback(async () => {
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(getNormalizedEditorMarkdown(editor, normalizeContent));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy markdown:', error);
    }
  }, [editor]);
  if (!editor) return null;
  const addLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl || 'https://');
    if (url === null) return;
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const button = (title: string, icon: ReactNode, action: () => void, active = false) => (
    <button
      type="button"
      onClick={action}
      className={cn(toolbarButtonClass, active && activeButtonClass)}
      title={title}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted">
      {button(
        'Bold',
        <Bold size={14} />,
        () => editor.chain().focus().toggleBold().run(),
        editor.isActive('bold')
      )}
      {button(
        'Italic',
        <Italic size={14} />,
        () => editor.chain().focus().toggleItalic().run(),
        editor.isActive('italic')
      )}
      <div className="w-px h-5 mx-1 bg-border" />
      {button(
        'Heading 1',
        <Heading1 size={14} />,
        () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        editor.isActive('heading', { level: 1 })
      )}
      {button(
        'Heading 2',
        <Heading2 size={14} />,
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        editor.isActive('heading', { level: 2 })
      )}
      {button(
        'Heading 3',
        <Heading3 size={14} />,
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        editor.isActive('heading', { level: 3 })
      )}
      <div className="w-px h-5 mx-1 bg-border" />
      {button(
        'Bullet list',
        <List size={14} />,
        () => editor.chain().focus().toggleBulletList().run(),
        editor.isActive('bulletList')
      )}
      {button(
        'Ordered list',
        <ListOrdered size={14} />,
        () => editor.chain().focus().toggleOrderedList().run(),
        editor.isActive('orderedList')
      )}
      <div className="w-px h-5 mx-1 bg-border" />
      {button(
        'Inline code',
        <Code size={14} />,
        () => editor.chain().focus().toggleCode().run(),
        editor.isActive('code')
      )}
      {button('Link', <Link size={14} />, addLink, editor.isActive('link'))}
      <div className="w-px h-5 mx-1 bg-border" />
      {button('Copy markdown', copied ? <Check size={14} /> : <Copy size={14} />, copyMarkdown)}
    </div>
  );
}
