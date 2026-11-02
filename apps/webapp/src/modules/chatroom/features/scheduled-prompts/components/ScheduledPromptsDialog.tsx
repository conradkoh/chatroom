'use client';

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import { ScheduledPromptsTab } from '../../../components/ScheduledPromptsTab';
import {
  isTopOverlayDismiss,
  popOverlayDismiss,
  pushOverlayDismiss,
} from '../../../components/shared/overlayDismissStack';
import {
  clearPendingScheduledPrompt,
  getPendingScheduledPrompt,
  getPendingScheduledPromptServerSnapshot,
  subscribePendingScheduledPrompt,
  type PendingScheduledPrompt,
} from '../stores/scheduledPromptComposerStore';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogScrollBody,
} from '@/components/ui/dialog';

interface ScheduledPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId: string;
}

interface ScheduledPromptsDialogBodyProps {
  chatroomId: string;
  pending: PendingScheduledPrompt | null;
  dismissHandler: () => void;
}

function ScheduledPromptsDialogBody({
  chatroomId,
  pending,
  dismissHandler,
}: ScheduledPromptsDialogBodyProps) {
  return (
    <DialogContent
      className="max-w-2xl max-h-[85vh] flex flex-col min-w-0"
      onEscapeKeyDown={(e: Event) => {
        if (!isTopOverlayDismiss(dismissHandler)) {
          e.preventDefault();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Scheduled Prompts</DialogTitle>
        <DialogDescription>Automatically send messages on a schedule.</DialogDescription>
      </DialogHeader>
      <DialogScrollBody>
        <ScheduledPromptsTab
          chatroomId={chatroomId}
          pendingPrefill={pending?.prefill ?? null}
          onScheduled={pending?.onScheduled}
          onPendingPrefillCleared={clearPendingScheduledPrompt}
        />
      </DialogScrollBody>
    </DialogContent>
  );
}

export function ScheduledPromptsDialog({
  open,
  onOpenChange,
  chatroomId,
}: ScheduledPromptsDialogProps) {
  // A composer right-click/long-press request opens the dialog prefilled, even
  // though the activity-bar button owns the dialog's own open state.
  const pending = useSyncExternalStore(
    subscribePendingScheduledPrompt,
    getPendingScheduledPrompt,
    getPendingScheduledPromptServerSnapshot
  );
  const isOpen = open || pending !== null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Dismissing the dialog also drops a composer request, so it cannot
      // reopen on the next render.
      if (!next) clearPendingScheduledPrompt();
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const onOpenChangeRef = useRef(handleOpenChange);
  onOpenChangeRef.current = handleOpenChange;

  const dismissHandler = useCallback(() => {
    onOpenChangeRef.current(false);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    pushOverlayDismiss(dismissHandler);
    return () => popOverlayDismiss(dismissHandler);
  }, [isOpen, dismissHandler]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <ScheduledPromptsDialogBody
        chatroomId={chatroomId}
        pending={pending}
        dismissHandler={dismissHandler}
      />
    </Dialog>
  );
}
