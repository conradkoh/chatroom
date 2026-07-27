'use client';

import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface RichTextToolbarProps {
  editor: Editor | null;
}

const toolbarButtonClass =
  'flex items-center justify-center w-7 h-7 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors';

const activeButtonClass = 'bg-chatroom-bg-tertiary text-chatroom-text-primary';

export function RichTextToolbar({ editor }: RichTextToolbarProps) {
  if (!editor) return null;

  const addLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-chatroom-border bg-chatroom-bg-tertiary">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cn(toolbarButtonClass, editor.isActive('bold') && activeButtonClass)}
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cn(toolbarButtonClass, editor.isActive('italic') && activeButtonClass)}
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <div className="w-px h-5 mx-1 bg-chatroom-border" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={cn(
          toolbarButtonClass,
          editor.isActive('heading', { level: 1 }) && activeButtonClass
        )}
        title="Heading 1"
      >
        <Heading1 size={14} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={cn(
          toolbarButtonClass,
          editor.isActive('heading', { level: 2 }) && activeButtonClass
        )}
        title="Heading 2"
      >
        <Heading2 size={14} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={cn(
          toolbarButtonClass,
          editor.isActive('heading', { level: 3 }) && activeButtonClass
        )}
        title="Heading 3"
      >
        <Heading3 size={14} />
      </button>
      <div className="w-px h-5 mx-1 bg-chatroom-border" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cn(toolbarButtonClass, editor.isActive('bulletList') && activeButtonClass)}
        title="Bullet list"
      >
        <List size={14} />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cn(toolbarButtonClass, editor.isActive('orderedList') && activeButtonClass)}
        title="Ordered list"
      >
        <ListOrdered size={14} />
      </button>
      <div className="w-px h-5 mx-1 bg-chatroom-border" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={cn(toolbarButtonClass, editor.isActive('code') && activeButtonClass)}
        title="Inline code"
      >
        <Code size={14} />
      </button>
      <button
        type="button"
        onClick={addLink}
        className={cn(toolbarButtonClass, editor.isActive('link') && activeButtonClass)}
        title="Link"
      >
        <Link size={14} />
      </button>
    </div>
  );
}
