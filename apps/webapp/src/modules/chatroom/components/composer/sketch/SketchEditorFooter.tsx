'use client';

import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../../shared/industrialDialogStyles';
import { DialogFooter } from '../../ui/dialog';

import { cn } from '@/lib/utils';

export type SketchEditorFooterProps = {
  isSaving: boolean;
  hasContent: boolean;
  onDismiss: () => void;
  onSave: () => void;
  className?: string;
  isImporting?: boolean;
};

export function SketchEditorFooter({
  isSaving,
  hasContent,
  onDismiss,
  onSave,
  className,
  isImporting,
}: SketchEditorFooterProps) {
  return (
    <DialogFooter className={className}>
      <button
        type="button"
        className={chatroomIndustrialButtonSecondaryClassName}
        disabled={isSaving}
        onClick={onDismiss}
      >
        Cancel
      </button>
      <button
        type="button"
        className={cn(chatroomIndustrialButtonPrimaryClassName, 'min-w-24')}
        disabled={!hasContent || isSaving || isImporting}
        onClick={onSave}
      >
        {isSaving ? 'Adding…' : 'Add sketch'}
      </button>
    </DialogFooter>
  );
}
