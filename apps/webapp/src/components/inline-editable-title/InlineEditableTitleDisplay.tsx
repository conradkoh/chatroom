'use client';

import { Pencil } from 'lucide-react';

import { inlineEditableTitlePencilButtonClassName } from './inline-editable-title-styles';

import { cn } from '@/lib/utils';

interface InlineEditableTitleDisplayProps {
  value: string;
  displayClassName: string;
  containerClassName?: string;
  editButtonTitle: string;
  onStartEdit: () => void;
}

export function InlineEditableTitleDisplay({
  value,
  displayClassName,
  containerClassName,
  editButtonTitle,
  onStartEdit,
}: InlineEditableTitleDisplayProps) {
  return (
    <div className={cn('flex items-center gap-2', containerClassName)}>
      <span className={displayClassName} title={value}>
        {value}
      </span>
      <button
        type="button"
        className={inlineEditableTitlePencilButtonClassName}
        onClick={onStartEdit}
        title={editButtonTitle}
        aria-label={editButtonTitle}
      >
        <Pencil size={12} />
      </button>
    </div>
  );
}
