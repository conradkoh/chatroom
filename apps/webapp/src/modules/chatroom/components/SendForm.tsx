'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { PlusCircle, X } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';

import { BacklogSelectorModal } from './BacklogSelectorModal';

interface SendFormProps {
  chatroomId: string;
}

type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: string;
  backlog?: {
    status: BacklogStatus;
  };
}

/**
 * Hook to detect if the user is on a touch device (likely mobile).
 * Uses touch capability detection rather than screen size for better accuracy.
 * Returns undefined during SSR/hydration to prevent layout flickering.
 */
function useIsTouchDevice(): boolean | undefined {
  const [mounted, setMounted] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    // Mark as mounted and check for touch capability
    setMounted(true);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouch(isTouchDevice);
  }, []);

  // Return undefined during SSR/hydration - component defaults to non-touch behavior
  return mounted ? isTouch : undefined;
}

export const SendForm = memo(function SendForm({ chatroomId }: SendFormProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Id<'chatroom_tasks'>[]>([]);
  const [isBacklogSelectorOpen, setIsBacklogSelectorOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useIsTouchDevice();

  // Type assertion workaround: The Convex API types are not fully generated
  // until `npx convex dev` is run. This assertion allows us to use the API
  // without full type safety. The correct types will be available after
  // running `npx convex dev` in the backend service.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  const sendMessage = useSessionMutation(chatroomApi.messages.send);

  // Query non-closed backlog tasks for the selector
  const backlogTasks = useSessionQuery(chatroomApi.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'backlog',
    limit: 50,
  }) as Task[] | undefined;

  // Filter to non-closed tasks for the selector
  const selectableTasks = useMemo(() => {
    if (!backlogTasks) return [];
    return backlogTasks.filter((t) => t.backlog?.status !== 'closed');
  }, [backlogTasks]);

  // Get selected task objects for display
  const selectedTasks = useMemo(() => {
    if (!backlogTasks) return [];
    return backlogTasks.filter((t) => selectedTaskIds.includes(t._id));
  }, [backlogTasks, selectedTaskIds]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    try {
      await sendMessage({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: 'user',
        content: message.trim(),
        type: 'message',
        // Include attached task IDs if any are selected
        ...(selectedTaskIds.length > 0 && { attachedTaskIds: selectedTaskIds }),
      });
      setMessage('');
      setSelectedTaskIds([]); // Clear selection after sending
    } catch (error) {
      console.error('Failed to send message:', error);
      // Keep the selection so user can retry
    } finally {
      setSending(false);
    }
  }, [message, sending, sendMessage, chatroomId, selectedTaskIds]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // On touch devices (mobile), Enter creates a newline
      // Submission only happens via the Send button
      if (isTouchDevice) {
        // Allow default behavior (newline) on Enter
        return;
      }

      // On desktop: Enter without Shift sends the message
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Shift+Enter allows newline (default behavior)
    },
    [handleSubmit, isTouchDevice]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleSubmit();
    },
    [handleSubmit]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  // Remove a task from selection
  const handleRemoveTask = useCallback((taskId: Id<'chatroom_tasks'>) => {
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
  }, []);

  // Handle task selection from modal
  const handleTasksSelected = useCallback((taskIds: Id<'chatroom_tasks'>[]) => {
    setSelectedTaskIds(taskIds);
    setIsBacklogSelectorOpen(false);
  }, []);

  // Truncate text helper
  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="bg-chatroom-bg-surface backdrop-blur-xl border-t-2 border-chatroom-border-strong">
      {/* Selected Tasks Pills */}
      {selectedTasks.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pt-3">
          {selectedTasks.map((task) => (
            <span
              key={task._id}
              className="text-[10px] px-2 py-0.5 bg-chatroom-bg-tertiary border border-chatroom-border flex items-center gap-1 text-chatroom-text-primary"
            >
              {truncate(task.content, 20)}
              <button
                type="button"
                onClick={() => handleRemoveTask(task._id)}
                className="text-chatroom-text-muted hover:text-chatroom-text-primary"
                aria-label={`Remove ${truncate(task.content, 20)}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input Form */}
      <form className="flex gap-3 p-4" onSubmit={handleFormSubmit}>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
          className="flex-1 bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm p-3 resize-none min-h-[44px] max-h-[200px] placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* Attach Backlog Button */}
        {selectableTasks.length > 0 && (
          <button
            type="button"
            onClick={() => setIsBacklogSelectorOpen(true)}
            className="p-3 text-chatroom-text-muted hover:text-chatroom-accent transition-colors bg-chatroom-bg-primary border-2 border-chatroom-border hover:border-chatroom-border-strong"
            title="Attach Backlog Tasks"
            aria-label="Attach backlog tasks"
          >
            <PlusCircle size={16} />
          </button>
        )}

        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="bg-chatroom-accent text-chatroom-bg-primary border-0 px-6 py-3 font-bold text-xs uppercase tracking-widest cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>

      {/* Backlog Selector Modal */}
      <BacklogSelectorModal
        isOpen={isBacklogSelectorOpen}
        tasks={selectableTasks}
        selectedTaskIds={selectedTaskIds}
        onClose={() => setIsBacklogSelectorOpen(false)}
        onConfirm={handleTasksSelected}
      />
    </div>
  );
});
