'use client';

import { ForwardRefEditor } from './ForwardRefEditor';
import type { MarkdownEditorProps } from './types';

import { cn } from '@/lib/utils';

export function MarkdownEditor({
  defaultMarkdown = '',
  onChange,
  className,
  placeholder,
  ...rest
}: MarkdownEditorProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card overflow-hidden', className)}>
      <ForwardRefEditor
        markdown={defaultMarkdown}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}
