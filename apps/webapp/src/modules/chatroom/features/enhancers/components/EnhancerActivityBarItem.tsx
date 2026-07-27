'use client';

import { Sparkles } from 'lucide-react';

import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';

interface EnhancerActivityBarItemProps {
  chatroomId: string;
  machineId: string | null;
}

export function EnhancerActivityBarItem({ chatroomId, machineId }: EnhancerActivityBarItemProps) {
  const { openDialog, dialog } = useEnhancerConfigDialogHost({
    chatroomId,
    workspaceMachineId: machineId,
  });

  return (
    <>
      <button
        type="button"
        className="relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100 text-chatroom-text-muted hover:text-chatroom-text-primary"
        onClick={() => openDialog()}
        title="Configure planning review"
        aria-label="Configure planning review"
        data-testid="enhancer-activity-bar-item"
      >
        <Sparkles size={20} />
      </button>

      {dialog}
    </>
  );
}
