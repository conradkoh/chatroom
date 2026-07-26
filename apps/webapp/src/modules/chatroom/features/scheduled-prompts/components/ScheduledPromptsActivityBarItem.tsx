'use client';

import { Clock } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ScheduledPromptsDialog } from './ScheduledPromptsDialog';

interface ScheduledPromptsActivityBarItemProps {
  chatroomId: string;
}

export function ScheduledPromptsActivityBarItem({
  chatroomId,
}: ScheduledPromptsActivityBarItemProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = useCallback(() => setDialogOpen(true), []);

  return (
    <>
      <button
        type="button"
        className="relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100 text-chatroom-text-muted hover:text-chatroom-text-primary"
        onClick={openDialog}
        title="Scheduled prompts"
        aria-label="Scheduled prompts"
        data-testid="scheduled-prompts-activity-bar-item"
      >
        <Clock size={20} />
      </button>
      <ScheduledPromptsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chatroomId={chatroomId}
      />
    </>
  );
}
