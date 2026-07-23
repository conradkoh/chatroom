'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';

import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/chatroom/components/ui/popover';

import { cn } from '@/lib/utils';

interface PlannerEnhancerIndicatorProps {
  chatroomId: string;
}

export function PlannerEnhancerIndicator({ chatroomId }: PlannerEnhancerIndicatorProps) {
  const { activeJob, isEnhancing, disableEnhancer, isDisabling } = useActiveEnhancerJob(chatroomId);
  const [open, setOpen] = useState(false);

  if (!isEnhancing || !activeJob) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center justify-center w-7 h-7 shrink-0 rounded-none',
            'text-chatroom-accent hover:bg-chatroom-bg-hover transition-colors',
            'animate-pulse'
          )}
          title="Enhancer active — click for options"
          aria-label="Enhancer enhancing handoff"
          data-testid="planner-enhancer-indicator"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Sparkles size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3 space-y-3"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
            Enhancing handoff
          </p>
          <p className="text-[10px] text-chatroom-text-muted mt-1">
            Attempt {activeJob.attemptCount}/{activeJob.maxAttempts} · {activeJob.fromRole}→
            {activeJob.toRole}
          </p>
        </div>
        <button
          type="button"
          disabled={isDisabling}
          onClick={() => void disableEnhancer().then(() => setOpen(false))}
          className="w-full text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 border border-chatroom-border text-chatroom-status-warning hover:bg-chatroom-bg-hover disabled:opacity-50"
          data-testid="planner-enhancer-disable"
        >
          Disable enhancer
        </button>
      </PopoverContent>
    </Popover>
  );
}
