'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  queuedMessageId: string;
  plannerEnhancerEnabled?: boolean;
  disabled?: boolean;
}

export function QueuedMessageEnhancerToggle({
  queuedMessageId,
  plannerEnhancerEnabled = false,
  disabled = false,
}: Props) {
  const update = useSessionMutation(api.messages.updateQueuedMessagePlannerEnhancer);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleToggle = useCallback(async () => {
    if (disabled || isUpdating) return;
    setIsUpdating(true);
    try {
      await update({
        queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        plannerEnhancerEnabled: !plannerEnhancerEnabled,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [disabled, isUpdating, update, queuedMessageId, plannerEnhancerEnabled]);

  return (
    <button
      type="button"
      data-testid="queued-message-enhancer-toggle"
      title={
        plannerEnhancerEnabled
          ? 'Enhancement enabled for this queued task'
          : 'Enhancement disabled for this queued task'
      }
      onClick={handleToggle}
      disabled={disabled || isUpdating}
      className={cn(
        'p-1.5 rounded transition-colors disabled:opacity-50',
        plannerEnhancerEnabled
          ? 'text-blue-500 dark:text-blue-400 hover:bg-blue-500/10'
          : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      <Sparkles size={14} className={plannerEnhancerEnabled ? 'fill-current' : undefined} />
    </button>
  );
}
