'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Plus,
  Play,
  ClipboardCheck,
  MoreHorizontal,
  XCircle,
  Clock,
  CheckCheck,
} from 'lucide-react';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import { BacklogCreateModal } from './BacklogCreateModal';
import { BacklogItemDetailModal } from './BacklogItemDetailModal';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQueueModal } from './TaskQueueModal';
import { type BacklogItem } from './backlog';
import type { Task, TaskCounts, WorkQueueProps } from './WorkQueue/types';
import { ViewMoreButton } from './WorkQueue/ViewMoreButton';
import { TaskItem } from './WorkQueue/TaskItem';
import { CompactBacklogItem } from './WorkQueue/CompactBacklogItem';
import { PendingReviewBacklogItem } from './WorkQueue/PendingReviewModal/PendingReviewBacklogItem';
import { ReviewPanel } from './ReviewPanel';
import { CurrentTasksModal } from './WorkQueue/CurrentTasksModal';
import { BacklogQueueModal } from './WorkQueue/BacklogQueueModal';
import { QueuedMessageItem } from './WorkQueue/QueuedMessageItem';
import type { Message } from '../types/message';
import { toast } from 'sonner';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Maximum number of pending review items to show in sidebar before "View More"
const PENDING_REVIEW_PREVIEW_LIMIT = 3;

// Maximum number of current tasks to show in sidebar before "View More"
const CURRENT_TASKS_PREVIEW_LIMIT = 3;

export function WorkQueue({ chatroomId, lifecycle, onRegisterActions }: WorkQueueProps) {
  const [isBacklogCreateModalOpen, setIsBacklogCreateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isPendingReviewModalOpen, setIsPendingReviewModalOpen] = useState(false);
  const [isCurrentTasksModalOpen, setIsCurrentTasksModalOpen] = useState(false);
  const [selectedBacklogItemId, setSelectedBacklogItemId] = useState<string | null>(null);
  const [isBacklogQueueModalOpen, setIsBacklogQueueModalOpen] = useState(false);

  // Register imperative open actions for parent (e.g. command palette)
  useEffect(() => {
    onRegisterActions?.({
      openBacklog: () => setIsBacklogQueueModalOpen(true),
      openPendingReview: () => setIsPendingReviewModalOpen(true),
    });
  }, [onRegisterActions]);

  // Query tasks
  const tasks = useSessionQuery(api.tasks.listTasks, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'active',
    limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
  }) as Task[] | undefined;

  // Query backlog items from the dedicated chatroom_backlog table
  // Only fetch items with status 'backlog' (excludes 'pending_user_review' items shown in the Pending Review section)
  const backlogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'backlog',
    limit: 100,
  });
  const backlogItems = (backlogItemsRaw ?? []) as BacklogItem[];

  // Query task counts
  const counts = useSessionQuery(api.tasks.getTaskCounts, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TaskCounts | undefined;

  // Derive needsPromotion from counts and lifecycle (replaces checkQueueHealth subscription)
  // A promotion is needed when: no active task, there are queued tasks, and all agents are waiting
  const needsPromotionRaw = useMemo(() => {
    if (!counts) return false;
    const hasActiveTask = counts.pending > 0 || counts.acknowledged > 0 || counts.in_progress > 0;
    const hasQueuedTasks = counts.queued > 0;
    if (!hasActiveTask && hasQueuedTasks) {
      // Check if all agents are waiting (lastSeenAction === 'get-next-task:started')
      const participants = lifecycle?.participants ?? [];
      const activeParticipants = participants.filter((p) => p.lastSeenAction !== 'exited');
      if (activeParticipants.length === 0) return true; // No active agents — allow promote
      const allWaiting = activeParticipants.every(
        (p) => p.lastSeenAction === 'get-next-task:started'
      );
      return allWaiting;
    }
    return false;
  }, [counts, lifecycle]);

  // Debounce needsPromotion to prevent flashing during normal task transitions.
  // The notice only appears after staying true for 2 seconds.
  const [needsPromotion, setNeedsPromotion] = useState(false);
  const needsPromotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (needsPromotionRaw) {
      needsPromotionTimerRef.current = setTimeout(() => setNeedsPromotion(true), 2000);
    } else {
      if (needsPromotionTimerRef.current) clearTimeout(needsPromotionTimerRef.current);
      setNeedsPromotion(false);
    }
    return () => {
      if (needsPromotionTimerRef.current) clearTimeout(needsPromotionTimerRef.current);
    };
  }, [needsPromotionRaw]);

  // Query pending review backlog items from the dedicated chatroom_backlog table
  const pendingReviewBacklogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    statusFilter: 'pending_user_review',
    limit: 100,
  });
  const pendingReviewBacklogItems = (pendingReviewBacklogItemsRaw ?? []) as BacklogItem[];

  // Derive selectedBacklogItem from live query data to avoid stale state after edits
  const selectedBacklogItem = useMemo(() => {
    if (!selectedBacklogItemId) return null;
    return (
      [...backlogItems, ...pendingReviewBacklogItems].find(
        (item) => item._id === selectedBacklogItemId
      ) ?? null
    );
  }, [selectedBacklogItemId, backlogItems, pendingReviewBacklogItems]);

  // Mutations
  const createBacklogItem = useSessionMutation(api.backlog.createBacklogItem);
  // TODO: remove once convex codegen catches up
  const completeAllPendingReview = useSessionMutation(
    (api.backlog as any).completeAllPendingReviewBacklogItems
  );
  const promoteNextTask = useSessionMutation(api.tasks.promoteNextTask);
  const updateTask = useSessionMutation(api.tasks.updateTask);
  const completeTaskById = useSessionMutation(api.tasks.completeTaskById);
  // Note: cancelTask mutation was removed in Phase 3 backlog cleanup

  // Queued messages mutations
  const promoteSpecificTask = useSessionMutation(api.tasks.promoteSpecificTask);
  const deleteQueuedMessage = useSessionMutation(api.messages.deleteQueuedMessage);

  // Fetch queued messages
  const queuedMessagesRaw = useSessionQuery(api.messages.listQueued, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const queuedMessages = (queuedMessagesRaw ?? []) as Message[];

  // Queued message handlers
  const handleQueuedPromote = useCallback(
    async (queuedMessageId: string) => {
      try {
        await promoteSpecificTask({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to promote queued message:', error);
      }
    },
    [promoteSpecificTask]
  );

  const handleQueuedDelete = useCallback(
    async (queuedMessageId: string) => {
      try {
        await deleteQueuedMessage({
          queuedMessageId: queuedMessageId as Id<'chatroom_messageQueue'>,
        });
      } catch (error) {
        console.error('Failed to delete queued message:', error);
      }
    },
    [deleteQueuedMessage]
  );

  // Categorize tasks by status
  const categorizedTasks = useMemo(() => {
    // Sort backlog items by updatedAt descending (most recently updated first)
    const sortedBacklog = [...backlogItems].sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      current: (tasks ?? []).filter(
        (t) => t.status === 'pending' || t.status === 'acknowledged' || t.status === 'in_progress'
      ),
      backlog: sortedBacklog,
    };
  }, [tasks, backlogItems]);

  // Handlers
  const handleAddTask = useCallback(
    async (content: string) => {
      await createBacklogItem({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content,
        createdBy: 'user',
      });
    },
    [createBacklogItem, chatroomId]
  );

  const handlePromoteNext = useCallback(async () => {
    try {
      await promoteNextTask({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
    } catch (error) {
      console.error('Failed to promote next task:', error);
    }
  }, [promoteNextTask, chatroomId]);

  // Modal handlers
  const handleOpenTaskDetail = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  const handleCloseTaskDetail = useCallback(() => {
    setSelectedTask(null);
  }, []);

  const handleModalEdit = useCallback(
    async (taskId: string, content: string) => {
      try {
        await updateTask({
          taskId: taskId as Id<'chatroom_tasks'>,
          content,
        });
        // Update selectedTask with new content to reflect edit immediately
        setSelectedTask((prev) => (prev ? { ...prev, content } : null));
      } catch (error) {
        console.error('Failed to update task:', error);
        throw error; // Re-throw so TaskDetailModal can handle it
      }
    },
    [updateTask]
  );

  const handleModalForceComplete = useCallback(
    async (taskId: string) => {
      try {
        await completeTaskById({
          taskId: taskId as Id<'chatroom_tasks'>,
          force: true,
        });
      } catch (error) {
        console.error('Failed to force complete task:', error);
        throw error;
      }
    },
    [completeTaskById]
  );

  // Batch close all acknowledged tasks (force complete)
  const handleCloseAllAcknowledged = useCallback(async () => {
    if (!categorizedTasks.current) return;

    // Filter for acknowledged tasks
    const acknowledgedTasks = categorizedTasks.current.filter((t) => t.status === 'acknowledged');

    if (acknowledgedTasks.length === 0) {
      console.log('No acknowledged tasks to close');
      return;
    }

    // Force complete all acknowledged tasks
    try {
      await Promise.all(
        acknowledgedTasks.map((task) =>
          completeTaskById({
            taskId: task._id as Id<'chatroom_tasks'>,
            force: true,
          })
        )
      );
      console.log(`Closed ${acknowledgedTasks.length} acknowledged tasks`);
    } catch (error) {
      console.error('Failed to close all acknowledged tasks:', error);
    }
  }, [categorizedTasks.current, completeTaskById]);

  const handleMarkAllReviewed = useCallback(async () => {
    try {
      const result = await completeAllPendingReview({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
      toast.success(`Marked ${result.completed} backlog item(s) as reviewed`);
    } catch {
      toast.error('Failed to mark items as reviewed');
    }
  }, [completeAllPendingReview, chatroomId]);

  if (tasks === undefined) {
    return (
      <div className="flex flex-col min-h-0 overflow-hidden">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Task Queue
        </div>
        <div className="p-4 text-center text-chatroom-text-muted text-xs">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden min-h-0">
      {/* Header */}
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border flex items-center justify-between flex-shrink-0">
        <span>Task Queue</span>
      </div>

      {/* Scrollable Task List Container */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Queue Health Warning - Show when promotion needed */}
        {needsPromotion && (
          <div className="p-3 border-b border-chatroom-border bg-chatroom-status-warning/10">
            <div className="flex items-center justify-between">
              <span className="text-xs text-chatroom-status-warning">
                Queue has tasks but none active
              </span>
              <button
                onClick={handlePromoteNext}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide bg-chatroom-status-warning text-chatroom-bg-primary hover:opacity-80 transition-colors"
                title="Promote next queued task to pending"
              >
                <Play size={10} />
                Start Next
              </button>
            </div>
          </div>
        )}

        {/* Current Task */}
        {categorizedTasks.current.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
              <span>Current ({categorizedTasks.current.length})</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1"
                    title="Actions"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onClick={handleCloseAllAcknowledged}
                    className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                  >
                    <XCircle size={14} />
                    Close All Acknowledged
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Show only first CURRENT_TASKS_PREVIEW_LIMIT items */}
            {categorizedTasks.current.slice(0, CURRENT_TASKS_PREVIEW_LIMIT).map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                isProtected
                onClick={() => handleOpenTaskDetail(task)}
              />
            ))}
            {/* Show "View More" button when there are more items */}
            {categorizedTasks.current.length > CURRENT_TASKS_PREVIEW_LIMIT && (
              <ViewMoreButton
                count={categorizedTasks.current.length - CURRENT_TASKS_PREVIEW_LIMIT}
                onClick={() => setIsCurrentTasksModalOpen(true)}
              />
            )}
          </div>
        )}

        {/* Queued Messages - Messages waiting to be processed */}
        {queuedMessages.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-orange-600 dark:text-orange-400 bg-chatroom-bg-tertiary flex items-center gap-2">
              <Clock size={12} />
              <span>Queued ({queuedMessages.length})</span>
            </div>
            {/* Show queued messages */}
            {queuedMessages.slice(0, 3).map((message) => (
              <QueuedMessageItem
                key={message._id}
                message={message}
                onPromote={handleQueuedPromote}
                onDelete={handleQueuedDelete}
              />
            ))}
            {queuedMessages.length > 3 && (
              <div className="px-3 py-1.5 text-center">
                <span className="text-[10px] text-muted-foreground">
                  + {queuedMessages.length - 3} more in queue
                </span>
              </div>
            )}
          </div>
        )}

        {/* Pending Review - Backlog items awaiting user confirmation */}
        {pendingReviewBacklogItems.length > 0 && (
          <div className="border-b border-chatroom-border">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={12} className="text-violet-500 dark:text-violet-400" />
                <span>Pending Review ({pendingReviewBacklogItems.length})</span>
              </div>
              <button
                onClick={handleMarkAllReviewed}
                className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
                title="Mark all as reviewed"
              >
                <CheckCheck size={14} />
              </button>
            </div>
            {/* Show backlog pending review items */}
            {pendingReviewBacklogItems.slice(0, PENDING_REVIEW_PREVIEW_LIMIT).map((item) => (
              <PendingReviewBacklogItem
                key={item._id}
                item={item}
                onClick={() => setSelectedBacklogItemId(item._id)}
              />
            ))}
            {/* Show "View More" button when there are more items in total */}
            {pendingReviewBacklogItems.length > PENDING_REVIEW_PREVIEW_LIMIT && (
              <ViewMoreButton
                count={pendingReviewBacklogItems.length - PENDING_REVIEW_PREVIEW_LIMIT}
                onClick={() => setIsPendingReviewModalOpen(true)}
              />
            )}
          </div>
        )}

        {/* Backlog Tasks */}
        <div className="border-b border-chatroom-border">
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
            <span>Backlog ({categorizedTasks.backlog.length})</span>
            <button
              onClick={() => setIsBacklogCreateModalOpen(true)}
              className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
              title="Add to backlog"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Compact Backlog Items - Show first 3 */}
          {categorizedTasks.backlog.slice(0, 3).map((item) => (
            <CompactBacklogItem
              key={item._id}
              item={item}
              onClick={() => setSelectedBacklogItemId(item._id)}
            />
          ))}

          {/* View More Button */}
          {categorizedTasks.backlog.length > 3 && (
            <ViewMoreButton
              count={categorizedTasks.backlog.length - 3}
              onClick={() => setIsBacklogQueueModalOpen(true)}
            />
          )}

          {categorizedTasks.backlog.length === 0 && (
            <div className="p-3 text-center text-chatroom-text-muted text-xs">No backlog items</div>
          )}
        </div>
        {/* End of Backlog Tasks */}
      </div>
      {/* End of Scrollable Task List Container */}

      {/* Full Task Queue Modal */}
      <TaskQueueModal
        isOpen={isQueueModalOpen}
        tasks={tasks || []}
        onClose={() => setIsQueueModalOpen(false)}
        onTaskClick={(task) => {
          // Keep queue modal open, detail modal will layer on top
          handleOpenTaskDetail(task);
        }}
      />

      {/* Task detail portals after queue so it stacks above the queue modal */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={true}
          task={selectedTask}
          onClose={handleCloseTaskDetail}
          onEdit={handleModalEdit}
          onDelete={handleModalForceComplete}
          onForceComplete={handleModalForceComplete}
        />
      )}

      {/* Review Panel — Split-pane layout for pending review items */}
      <ReviewPanel
        isOpen={isPendingReviewModalOpen}
        onClose={() => setIsPendingReviewModalOpen(false)}
        chatroomId={chatroomId as Id<'chatroom_rooms'>}
      />

      {/* Current Tasks Modal */}
      {isCurrentTasksModalOpen && (
        <CurrentTasksModal
          tasks={categorizedTasks.current}
          onClose={() => setIsCurrentTasksModalOpen(false)}
          onTaskClick={(task) => {
            handleOpenTaskDetail(task);
          }}
        />
      )}

      {/* Backlog Create Modal */}
      <BacklogCreateModal
        isOpen={isBacklogCreateModalOpen}
        onClose={() => setIsBacklogCreateModalOpen(false)}
        onSubmit={handleAddTask}
      />

      {/* Backlog Item Detail Modal */}
      {selectedBacklogItem && (
        <BacklogItemDetailModal
          isOpen={true}
          item={selectedBacklogItem}
          onClose={() => setSelectedBacklogItemId(null)}
        />
      )}

      {/* Backlog Queue Modal - shows all backlog items */}
      {isBacklogQueueModalOpen && (
        <BacklogQueueModal
          items={categorizedTasks.backlog}
          onClose={() => setIsBacklogQueueModalOpen(false)}
          onItemClick={(item) => {
            setSelectedBacklogItemId(item._id);
          }}
        />
      )}
    </div>
  );
}
