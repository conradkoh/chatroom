'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Clock, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { ChatroomDestructiveTextButton } from '../../../components/ui/ChatroomDestructiveTextButton';
import { formatSchedule, formatTime } from '../utils/scheduledPromptFormat';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

interface ScheduledPromptDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledPromptId: Id<'chatroom_scheduledPrompts'>;
}

export function ScheduledPromptDetailDialog({
  open,
  onOpenChange,
  scheduledPromptId,
}: ScheduledPromptDetailDialogProps) {
  const prompt = useSessionQuery(api.scheduledPrompts.get, open ? { scheduledPromptId } : 'skip');
  const triggered = useSessionQuery(
    api.scheduledPrompts.listTriggeredMessages,
    open ? { scheduledPromptId, limit: 20 } : 'skip'
  );
  const setEnabled = useSessionMutation(api.scheduledPrompts.setEnabled);
  const [disabling, setDisabling] = useState(false);

  const isActive = prompt?.disabledReason === undefined;
  const canDisable = prompt !== undefined && isActive;

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleDisable = useCallback(async () => {
    setDisabling(true);
    try {
      await setEnabled({ scheduledPromptId, enabled: false });
      onOpenChange(false);
    } catch {
      toast.error('Failed to disable schedule. Please try again.');
    } finally {
      setDisabling(false);
    }
  }, [scheduledPromptId, setEnabled, onOpenChange]);

  const displayName =
    prompt?.name ||
    (prompt?.prompt ? prompt.prompt.slice(0, 60) + (prompt.prompt.length > 60 ? '...' : '') : '');

  const statusLabel =
    prompt?.disabledReason === 'archive'
      ? 'Disabled by archive'
      : prompt?.disabledReason === 'user'
        ? 'Disabled'
        : 'Active';

  return (
    <FixedModal isOpen={open} onClose={handleClose} maxWidth="max-w-lg">
      <FixedModalContent>
        <FixedModalHeader onClose={handleClose}>
          <div className="flex items-center gap-2">
            <Clock size={16} />
            <FixedModalTitle>{displayName || 'Scheduled Prompt'}</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <p className="px-4 pt-1 pb-2 text-xs text-chatroom-text-muted">
          Schedule details and trigger history.
        </p>
        <FixedModalBody>
          <div className="px-4 pb-4">
            {prompt === undefined ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-chatroom-text-muted" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-chatroom-text-muted">{formatSchedule(prompt)}</p>
                  <p className="text-[11px] text-chatroom-text-muted">
                    Status: <span className="font-bold">{statusLabel}</span>
                  </p>
                  {prompt.lastRunAt && (
                    <p className="text-[11px] text-chatroom-text-muted">
                      Last run: {formatTime(prompt.lastRunAt)}
                    </p>
                  )}
                  {prompt.nextRunAt && isActive && (
                    <p className="text-[11px] text-chatroom-text-muted">
                      Next run: {formatTime(prompt.nextRunAt)}
                    </p>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary mb-2">
                    Trigger history
                  </h4>
                  {triggered === undefined ? (
                    <Loader2 size={16} className="animate-spin text-chatroom-text-muted" />
                  ) : triggered.length === 0 ? (
                    <p className="text-xs text-chatroom-text-muted">No messages triggered yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {triggered.map((msg) => (
                        <li
                          key={msg._id}
                          className="text-xs border border-chatroom-border p-2 bg-chatroom-bg-secondary"
                        >
                          <span className="text-[10px] text-chatroom-text-muted block mb-0.5">
                            {formatTime(msg._creationTime)}
                          </span>
                          <span className="text-chatroom-text-primary line-clamp-2">
                            {msg.content.length > 80
                              ? msg.content.slice(0, 80) + '...'
                              : msg.content}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {triggered && triggered.length > 0 && (
                    <p className="text-[10px] text-chatroom-text-muted mt-2">
                      Showing last 20 runs.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </FixedModalBody>
        {canDisable && (
          <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex flex-col items-stretch gap-1 flex-shrink-0">
            <ChatroomDestructiveTextButton
              size="industrial"
              onClick={handleDisable}
              disabled={disabling}
            >
              {disabling ? <Loader2 size={12} className="animate-spin" /> : 'Disable schedule'}
            </ChatroomDestructiveTextButton>
            <p className="text-[10px] text-chatroom-text-muted text-center">
              Stops future runs. Existing messages are kept. Re-enable from the Scheduled prompts
              panel.
            </p>
          </div>
        )}
      </FixedModalContent>
    </FixedModal>
  );
}
