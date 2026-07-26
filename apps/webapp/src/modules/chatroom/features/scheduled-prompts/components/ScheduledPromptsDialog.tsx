'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

import { ScheduledPromptsTab } from '../../../components/ScheduledPromptsTab';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import {
  isTopOverlayDismiss,
  popOverlayDismiss,
  pushOverlayDismiss,
} from '../../../components/shared/overlayDismissStack';

interface ScheduledPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId: string;
}

export function ScheduledPromptsDialog({
  open,
  onOpenChange,
  chatroomId,
}: ScheduledPromptsDialogProps) {
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const dismissHandler = useCallback(() => {
    onOpenChangeRef.current(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    pushOverlayDismiss(dismissHandler);
    return () => popOverlayDismiss(dismissHandler);
  }, [open, dismissHandler]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0"
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
        <ScheduledPromptsTab chatroomId={chatroomId} />
      </DialogContent>
    </Dialog>
  );
}
