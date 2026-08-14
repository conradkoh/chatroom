'use client';

import dynamic from 'next/dynamic';
import type { KeyboardEvent } from 'react';

import { backlogRichTextEditorProseClassNames } from './markdown-utils';
import { isModEnterKey } from '../utils/isModEnterKey';

import type { MarkdownEditorProps } from '@/components/markdown-editor';
import { cn } from '@/lib/utils';

export const ChatroomMarkdownEditor = dynamic(
  () =>
    import('@/components/markdown-editor').then(({ MarkdownEditor }) => ({
      default: MarkdownEditor,
    })),
  { ssr: false }
);

export function chatroomEditorContentClassName(extra?: string) {
  return cn(
    'prose dark:prose-invert max-w-none min-h-0 flex-1 px-4 py-3 text-sm',
    backlogRichTextEditorProseClassNames,
    extra
  );
}

export const CHATROOM_EDITOR_WRAPPER_CLASS =
  'flex flex-col flex-1 min-h-0 border-0 rounded-none bg-transparent overflow-hidden shadow-none';

const CHATROOM_EDITOR_ROOT_CLASS = 'mdxeditor-full-height flex-1 min-h-0';

export function handleChatroomModEnterCapture(
  event: KeyboardEvent,
  action: () => void,
  disabled?: boolean
) {
  if (disabled || !isModEnterKey(event.nativeEvent)) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

export type ChatroomMarkdownEditorProps = MarkdownEditorProps & {
  editorKey?: string;
  onModEnter?: () => void;
  modEnterDisabled?: boolean;
};

export function ChatroomMarkdownEditorShell({
  editorKey,
  onModEnter,
  modEnterDisabled,
  contentEditableClassName,
  className,
  ...editorProps
}: ChatroomMarkdownEditorProps) {
  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      onKeyDownCapture={
        onModEnter
          ? (e) => handleChatroomModEnterCapture(e, onModEnter, modEnterDisabled)
          : undefined
      }
    >
      <ChatroomMarkdownEditor
        key={editorKey}
        contentEditableClassName={chatroomEditorContentClassName(contentEditableClassName)}
        className={cn(CHATROOM_EDITOR_WRAPPER_CLASS, className)}
        editorClassName={CHATROOM_EDITOR_ROOT_CLASS}
        {...editorProps}
      />
    </div>
  );
}
