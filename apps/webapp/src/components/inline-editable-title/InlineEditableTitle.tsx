'use client';

import type { ClipboardEvent, KeyboardEvent, Ref } from 'react';

import {
  inlineEditableTitleDisplayClassName,
  inlineEditableTitleInputClassName,
} from './inline-editable-title-styles';
import { InlineEditableTitleDisplay } from './InlineEditableTitleDisplay';
import { InlineEditableTitleEditing } from './InlineEditableTitleEditing';

export interface InlineEditableTitleProps {
  value: string;
  editedValue: string;
  onEditedValueChange: (value: string) => void;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  isPending?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  maxLength?: number;
  placeholder?: string;
  editButtonTitle: string;
  saveButtonTitle?: string;
  cancelButtonTitle?: string;
  inputAriaLabel: string;
  displayClassName?: string;
  inputClassName?: string;
  containerClassName?: string;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function InlineEditableTitle({
  value,
  editedValue,
  onEditedValueChange,
  isEditing,
  onStartEdit,
  onCancel,
  onSave,
  isPending = false,
  inputRef,
  maxLength,
  placeholder,
  editButtonTitle,
  saveButtonTitle = 'Save',
  cancelButtonTitle = 'Cancel',
  inputAriaLabel,
  displayClassName = inlineEditableTitleDisplayClassName,
  inputClassName = inlineEditableTitleInputClassName,
  containerClassName,
  onPaste,
  onKeyDown,
}: InlineEditableTitleProps) {
  if (isEditing) {
    return (
      <InlineEditableTitleEditing
        editedValue={editedValue}
        onEditedValueChange={onEditedValueChange}
        onCancel={onCancel}
        onSave={onSave}
        isPending={isPending}
        inputRef={inputRef}
        maxLength={maxLength}
        placeholder={placeholder}
        saveButtonTitle={saveButtonTitle}
        cancelButtonTitle={cancelButtonTitle}
        inputAriaLabel={inputAriaLabel}
        inputClassName={inputClassName}
        containerClassName={containerClassName}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <InlineEditableTitleDisplay
      value={value}
      displayClassName={displayClassName}
      containerClassName={containerClassName}
      editButtonTitle={editButtonTitle}
      onStartEdit={onStartEdit}
    />
  );
}
