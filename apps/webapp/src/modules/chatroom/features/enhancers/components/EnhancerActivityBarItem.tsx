'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';

import { EnhancerConfigDialog } from './EnhancerConfigDialog';
import { useEnhancerConfig } from '../hooks/useEnhancerConfig';

import { cn } from '@/lib/utils';

interface EnhancerActivityBarItemProps {
  chatroomId: string;
  machineId: string | null;
}

export function EnhancerActivityBarItem({ chatroomId, machineId }: EnhancerActivityBarItemProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { config, isActive, saveConfig, disable } = useEnhancerConfig(chatroomId);

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
        onClick={() => setDialogOpen(true)}
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

      <EnhancerConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chatroomId={chatroomId}
        machineId={machineId}
        initialConfig={config}
        onConfirm={(cfg) => {
          saveConfig(cfg);
          setDialogOpen(false);
        }}
        onDisable={() => {
          disable();
          setDialogOpen(false);
        }}
      />
    </>
  );
}
