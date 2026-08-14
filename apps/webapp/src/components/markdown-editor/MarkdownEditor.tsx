'use client';

import { ForwardRefEditor } from './ForwardRefEditor';
import type { MarkdownEditorProps } from './types';

import { cn } from '@/lib/utils';

export function MarkdownEditor({
  defaultMarkdown = '',
  onChange,
  className,
  editorClassName,
  placeholder,
  ...rest
}: MarkdownEditorProps) {
  const editor = (
    <ForwardRefEditor
      markdown={defaultMarkdown}
      onChange={onChange}
      placeholder={placeholder}
      className={editorClassName}
      {...rest}
    />
  );

  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden', className)}>
      {editorClassName ? (
        <div className="flex flex-col flex-1 min-h-0 h-full">{editor}</div>
      ) : (
        editor
      )}
    </div>
  );
}
