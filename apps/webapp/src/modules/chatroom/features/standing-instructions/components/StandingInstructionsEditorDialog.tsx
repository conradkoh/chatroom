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

function buildConfirmPayload(
  draft: string,
  draftTitle: string,
  showApplyToAllChatrooms: boolean,
  applyToAllChatrooms: boolean
): { content: string; title: string; applyToAllChatrooms?: boolean } {
  const payload: { content: string; title: string; applyToAllChatrooms?: boolean } = {
    content: draft.trim(),
    title: draftTitle.trim(),
  };
  if (showApplyToAllChatrooms) {
    payload.applyToAllChatrooms = applyToAllChatrooms;
  }
  return payload;
}

// fallow-ignore-next-line complexity
export function StandingInstructionsEditorDialog({
  open,
  onOpenChange,
  dialogTitle,
  initialContent,
  initialTitle,
  onConfirm,
  closeOnConfirm = true,
  showApplyToAllChatrooms = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogTitle: string;
  initialContent: string;
  initialTitle: string;
  onConfirm: (payload: {
    content: string;
    title: string;
    applyToAllChatrooms?: boolean;
  }) => void | Promise<void>;
  closeOnConfirm?: boolean;
  /** Show the "apply to all my chatrooms" checkbox (history-template edits only). */
  showApplyToAllChatrooms?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);
  const [draft, setDraft] = useState(initialContent);
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const [applyToAllChatrooms, setApplyToAllChatrooms] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(initialContent);
      setDraftTitle(initialTitle);
      setApplyToAllChatrooms(false);
    }
  }, [open, initialContent, initialTitle]);

  const confirmDisabled = !draft.trim() || !draftTitle.trim();

  const handleConfirm = async () => {
    const payload = buildConfirmPayload(
      draft,
      draftTitle,
      showApplyToAllChatrooms,
      applyToAllChatrooms
    );
    try {
      await onConfirm(payload);
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
        {showApplyToAllChatrooms && (
          <label className="flex items-start gap-2 px-1 text-sm text-chatroom-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAllChatrooms}
              onChange={(e) => setApplyToAllChatrooms(e.target.checked)}
              className="mt-0.5 accent-chatroom-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span>Apply to all my chatrooms using this template</span>
              <span className="text-xs text-chatroom-text-muted">
                Updates all of your chatrooms using this template
              </span>
            </span>
          </label>
        )}
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
