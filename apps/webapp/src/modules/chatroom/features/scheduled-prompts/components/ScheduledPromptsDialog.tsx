'use client';

import { ScheduledPromptsTab } from '../../../components/ScheduledPromptsTab';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden min-w-0">
        <DialogHeader>
          <DialogTitle>Scheduled Prompts</DialogTitle>
          <DialogDescription>Automatically send messages on a schedule.</DialogDescription>
        </DialogHeader>
        <ScheduledPromptsTab chatroomId={chatroomId} />
      </DialogContent>
    </Dialog>
  );
}
