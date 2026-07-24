'use client';

import { Sparkles } from 'lucide-react';

import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';

import { cn } from '@/lib/utils';

interface EnhancerActivityBarItemProps {
  chatroomId: string;
  machineId: string | null;
}

export function EnhancerActivityBarItem({ chatroomId, machineId }: EnhancerActivityBarItemProps) {
  const { isActive, openDialog, dialog } = useEnhancerConfigDialogHost({
    chatroomId,
    workspaceMachineId: machineId,
  });

  return (
    <>
      <button
        type="button"
        className={cn(
          'relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100',
          isActive
            ? 'text-chatroom-text-primary'
            : 'text-chatroom-text-muted hover:text-chatroom-text-primary'
        )}
        onClick={openDialog}
        title={isActive ? 'Enhancer active — click to configure' : 'Configure enhancer'}
        aria-label={isActive ? 'Enhancer active' : 'Configure enhancer'}
        aria-pressed={isActive}
        data-testid="enhancer-activity-bar-item"
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-chatroom-accent" />
        )}
        <Sparkles size={20} />
      </button>

      {dialog}
    </>
  );
}
