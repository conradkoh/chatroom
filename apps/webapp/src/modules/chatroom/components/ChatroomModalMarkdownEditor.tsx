'use client';

import { MarkdownEditor } from '@/components/markdown-editor';
import { cn } from '@/lib/utils';
import { normalizeChatroomMarkdownContent } from '../utils/normalizeChatroomMarkdownContent';

export interface ChatroomModalMarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  initialClickCoords?: { left: number; top: number } | null;
  className?: string;
  proseClassName: string;
}

export function ChatroomModalMarkdownEditor({
  value,
  onChange,
  placeholder,
  autoFocus,
  onCmdEnter,
  initialClickCoords,
  className,
  proseClassName,
}: ChatroomModalMarkdownEditorProps) {
  return (
    <MarkdownEditor
      defaultMarkdown={value}
      onChange={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onCmdEnter={onCmdEnter}
      initialClickCoords={initialClickCoords}
      fillHeight
      className={cn('flex-1 flex flex-col min-h-0 !border-0 rounded-none shadow-none', className)}
      proseClassName={proseClassName}
      normalizeContent={normalizeChatroomMarkdownContent}
    />
  );
}
