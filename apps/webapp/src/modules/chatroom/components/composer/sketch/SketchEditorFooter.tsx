'use client';

import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../../shared/industrialDialogStyles';

import { InlineFeedback, type Feedback } from '@/components/inline-feedback';
import { DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type SketchEditorFooterProps = {
  isSaving: boolean;
  hasContent: boolean;
  onDismiss: () => void;
  onSave: () => void;
  className?: string;
  isImporting?: boolean;
  /** Export failure, rendered inline beside the Add sketch control. */
  feedback?: Feedback | null;
};

export function SketchEditorFooter({
  isSaving,
  hasContent,
  onDismiss,
  onSave,
  className,
  isImporting,
  feedback = null,
}: SketchEditorFooterProps) {
  return (
    <DialogFooter className={className}>
      <InlineFeedback
        feedback={feedback}
        variant="text"
        className="min-w-0 text-right sm:flex-1 sm:self-center"
        data-testid="sketch-export-feedback"
      />
      <button
        type="button"
        className={chatroomIndustrialButtonSecondaryClassName}
        disabled={isSaving}
        onClick={onDismiss}
      >
        Close
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
