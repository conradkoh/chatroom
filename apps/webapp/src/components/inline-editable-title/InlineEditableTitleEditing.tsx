'use client';

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react';

import { applyInlineEditableTitleKeyDown } from './applyInlineEditableTitleKeyDown';
import { InlineEditableTitleActionButtons } from './InlineEditableTitleActionButtons';

import { cn } from '@/lib/utils';

interface InlineEditableTitleEditingProps {
  editedValue: string;
  onEditedValueChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  isPending?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
  placeholder?: string;
  saveButtonTitle: string;
  cancelButtonTitle: string;
  inputAriaLabel: string;
  inputClassName: string;
  containerClassName?: string;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function InlineEditableTitleEditing({
  editedValue,
  onEditedValueChange,
  onCancel,
  onSave,
  isPending = false,
  inputRef: inputRefProp,
  maxLength,
  placeholder,
  saveButtonTitle,
  cancelButtonTitle,
  inputAriaLabel,
  inputClassName,
  containerClassName,
  onPaste,
  onKeyDown,
}: InlineEditableTitleEditingProps) {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = inputRefProp ?? internalInputRef;

  useEffect(() => {
    const input = typeof inputRef === 'function' ? null : inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [inputRef]);

  return (
    <div className={cn('flex items-center gap-2', containerClassName)}>
      <input
        ref={inputRef}
        type="text"
        value={editedValue}
        onChange={(event) => onEditedValueChange(event.target.value)}
        onKeyDown={(event) => applyInlineEditableTitleKeyDown(event, onSave, onCancel, onKeyDown)}
        onPaste={onPaste}
        className={inputClassName}
        placeholder={placeholder}
        disabled={isPending}
        maxLength={maxLength}
        aria-label={inputAriaLabel}
      />
      <InlineEditableTitleActionButtons
        onSave={onSave}
        onCancel={onCancel}
        isPending={isPending}
        saveButtonTitle={saveButtonTitle}
        cancelButtonTitle={cancelButtonTitle}
      />
    </div>
  );
}
