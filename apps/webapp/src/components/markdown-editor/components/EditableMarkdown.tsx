'use client';

import { useCallback, useState } from 'react';

import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownViewer } from './MarkdownViewer';
import type { EditableMarkdownProps } from '../types';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EditableMarkdown({
  markdown,
  onChange,
  onSave,
  onCancel,
  placeholder = 'Click to edit...',
  className,
  proseClassName,
}: EditableMarkdownProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(markdown);

  const enterEdit = useCallback(() => {
    setDraft(markdown);
    setIsEditing(true);
  }, [markdown]);

  const handleSave = useCallback(() => {
    onChange(draft);
    onSave?.(draft);
    setIsEditing(false);
  }, [draft, onChange, onSave]);

  const handleCancel = useCallback(() => {
    setDraft(markdown);
    onCancel?.();
    setIsEditing(false);
  }, [markdown, onCancel]);

  const handleViewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('a')) return;
      enterEdit();
    },
    [enterEdit]
  );

  const handleViewKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        enterEdit();
      }
    },
    [enterEdit]
  );

  if (isEditing) {
    return (
      <div className={cn('space-y-3', className)}>
        <MarkdownEditor
          defaultMarkdown={draft}
          onChange={setDraft}
          placeholder={placeholder}
          proseClassName={proseClassName}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  const isEmpty = !markdown.trim();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Edit markdown"
      onClick={handleViewClick}
      onKeyDown={handleViewKeyDown}
      className={cn(
        'rounded-lg p-4 cursor-pointer transition-colors',
        'hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isEmpty && 'text-muted-foreground',
        className
      )}
    >
      {isEmpty ? <p className="text-sm">{placeholder}</p> : <MarkdownViewer markdown={markdown} />}
    </div>
  );
}
