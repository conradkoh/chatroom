'use client';

import { Check, X } from 'lucide-react';

import {
  inlineEditableTitleCancelButtonClassName,
  inlineEditableTitleSaveButtonClassName,
} from './inline-editable-title-styles';

interface InlineEditableTitleActionButtonsProps {
  onSave: () => void;
  onCancel: () => void;
  isPending?: boolean;
  saveButtonTitle: string;
  cancelButtonTitle: string;
}

export function InlineEditableTitleActionButtons({
  onSave,
  onCancel,
  isPending = false,
  saveButtonTitle,
  cancelButtonTitle,
}: InlineEditableTitleActionButtonsProps) {
  return (
    <>
      <button
        type="button"
        className={inlineEditableTitleSaveButtonClassName}
        onClick={onSave}
        disabled={isPending}
        title={saveButtonTitle}
      >
        <Check size={12} />
      </button>
      <button
        type="button"
        className={inlineEditableTitleCancelButtonClassName}
        onClick={onCancel}
        disabled={isPending}
        title={cancelButtonTitle}
      >
        <X size={12} />
      </button>
    </>
  );
}
