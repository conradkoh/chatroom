'use client';

import { useEffect, useState } from 'react';

import { StandingInstructionsEditorForm } from './StandingInstructionsEditorForm';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../../../components/shared/industrialDialogStyles';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

export function StandingInstructionsEditorDialog({
  open,
  onOpenChange,
  dialogTitle,
  initialContent,
  initialTitle,
  onConfirm,
  closeOnConfirm = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogTitle: string;
  initialContent: string;
  initialTitle: string;
  onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
  closeOnConfirm?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);
  const [draft, setDraft] = useState(initialContent);
  const [draftTitle, setDraftTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) {
      setDraft(initialContent);
      setDraftTitle(initialTitle);
    }
  }, [open, initialContent, initialTitle]);

  const confirmDisabled = !draft.trim() || !draftTitle.trim();

  const handleConfirm = async () => {
    try {
      await onConfirm({ content: draft.trim(), title: draftTitle.trim() });
      if (closeOnConfirm) onOpenChange(false);
    } catch {
      // Keep dialog open so the user can retry after a failed save.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent
        floating
        className="sm:max-w-md max-h-[min(90dvh,100%)]"
        style={{ paddingBottom: keyboardInsetPx > 0 ? `${keyboardInsetPx}px` : undefined }}
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <StandingInstructionsEditorForm
          draft={draft}
          draftTitle={draftTitle}
          onDraftChange={setDraft}
          onDraftTitleChange={setDraftTitle}
          onConfirm={handleConfirm}
          onCancel={() => onOpenChange(false)}
          confirmDisabled={confirmDisabled}
          mobile={!isDesktop}
        />
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={chatroomIndustrialButtonSecondaryClassName}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={cn(
              chatroomIndustrialButtonPrimaryClassName,
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
