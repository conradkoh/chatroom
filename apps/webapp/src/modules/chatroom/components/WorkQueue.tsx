'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  Plus,
  Play,
  ClipboardCheck,
  MoreHorizontal,
  XCircle,
  Clock,
  CheckCheck,
  CircleDot,
  List,
} from 'lucide-react';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { type BacklogItem } from './backlog';
import { BacklogCreateModal } from './BacklogCreateModal';
import { BacklogItemDetailModal } from './BacklogItemDetailModal';
import { QueueFrontMessageModal } from './QueueFrontMessageModal';
import { ReviewPanel } from './ReviewPanel';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskQueueModal } from './TaskQueueModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { BacklogQueueModal } from './WorkQueue/BacklogQueueModal';
import { CompactBacklogItem } from './WorkQueue/CompactBacklogItem';
import { CurrentTasksModal } from './WorkQueue/CurrentTasksModal';
import { PendingReviewBacklogItem } from './WorkQueue/PendingReviewModal/PendingReviewBacklogItem';
import { useActiveEnhancerJob } from '../features/enhancers/hooks/useActiveEnhancerJob';
import { useQueuedMessageActions } from '../hooks/useQueuedMessageActions';
import type { Message } from '../types/message';
import { QueuedMessageItem } from './WorkQueue/QueuedMessageItem';
import { QueuedMessagesModal } from './WorkQueue/QueuedMessagesModal';
import { TaskItem } from './WorkQueue/TaskItem';
import type { Task, TaskCounts, WorkQueueProps } from './WorkQueue/types';
import { SIDEBAR_PREVIEW_LIMIT, SidebarSection } from './sidebar/SidebarSection';
import { teamSupportsEnhancer } from '../hooks/persistence/teamEnhancerSupport';
import { useAgentPanelData } from '../hooks/useAgentPanelData';
import { useAgentStatuses } from '../hooks/useAgentStatuses';

export function WorkQueue({ chatroomId, onRegisterActions }: WorkQueueProps) {
  const [isBacklogCreateModalOpen, setIsBacklogCreateModalOpen] = useState(false);
  const [isQueueFrontModalOpen, setIsQueueFrontModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [isPendingReviewModalOpen, setIsPendingReviewModalOpen] = useState(false);
  const [isCurrentTasksModalOpen, setIsCurrentTasksModalOpen] = useState(false);
  const [selectedBacklogItemId, setSelectedBacklogItemId] = useState<string | null>(null);
  const [isBacklogQueueModalOpen, setIsBacklogQueueModalOpen] = useState(false);
  const [isQueuedMessagesModalOpen, setIsQueuedMessagesModalOpen] = useState(false);

  // Register imperative open actions for parent (e.g. command palette)
  useEffect(() => {
    onRegisterActions?.({
      openBacklog: () => setIsBacklogQueueModalOpen(true),
      openPendingReview: () => setIsPendingReviewModalOpen(true),
      openBacklogCreate: () => setIsBacklogCreateModalOpen(true),
    });
  }, [onRegisterActions]);

  // Query tasks
  const tasks = useSessionQuery(api.tasks.listTasks, {
    chatroomId,
    statusFilter: 'active',
    limit: 100, // Match MAX_TASK_LIST_LIMIT from backend
  }) as Task[] | undefined;

  // Query backlog items from the dedicated chatroom_backlog table
  // Only fetch items with status 'backlog' (excludes 'pending_user_review' items shown in the Pending Review section)
  const backlogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId,
    statusFilter: 'backlog',
    limit: 100,
  });
  const backlogItems = useMemo(() => (backlogItemsRaw ?? []) as BacklogItem[], [backlogItemsRaw]);

  // Query task counts
  const counts = useSessionQuery(api.tasks.getTaskCounts, {
    chatroomId,
  }) as TaskCounts | undefined;

  // Active entry-point→enhancer job (job-only hook; disabling enhancement is separate)
  const { isEnhancing, cancelJob, isCancelling } = useActiveEnhancerJob(chatroomId as string);

  const {
    teamId,
    teamRoles,
    statusReadModel,
    isLoading: teamRolesLoading,
  } = useAgentPanelData(chatroomId);
  const nonUserRoles = useMemo(
    () => (teamRoles ?? []).filter((role) => role.toLowerCase() !== 'user'),
    [teamRoles]
  );
  const { aggregateStatus } = useAgentStatuses(nonUserRoles, statusReadModel);

  // Derive needsPromotion from read-model readiness (replaces checkQueueHealth subscription)
  // A promotion is needed when: no active task, there are queued tasks, and all agents are waiting
  const needsPromotionRaw = useMemo(() => {
    if (!counts) return false;
    const hasActiveTask = counts.pending > 0 || counts.acknowledged > 0 || counts.in_progress > 0;
    const hasQueuedTasks = counts.queued > 0;
    if (!hasActiveTask && hasQueuedTasks) {
      if (nonUserRoles.length === 0) return true;
      return aggregateStatus === 'ready';
    }
    return false;
  }, [counts, nonUserRoles, aggregateStatus]);

  // Debounce needsPromotion to prevent flashing during normal task transitions.
  // The notice only appears after staying true for 2 seconds.
  const [needsPromotion, setNeedsPromotion] = useState(false);
  const needsPromotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (needsPromotionRaw) {
      needsPromotionTimerRef.current = setTimeout(() => setNeedsPromotion(true), 2000);
    } else {
      if (needsPromotionTimerRef.current) clearTimeout(needsPromotionTimerRef.current);
    }
    return () => {
      if (needsPromotionTimerRef.current) clearTimeout(needsPromotionTimerRef.current);
    };
  }, [needsPromotionRaw]);
  const effectiveNeedsPromotion = needsPromotionRaw && needsPromotion;

  // Query pending review backlog items from the dedicated chatroom_backlog table
  const pendingReviewBacklogItemsRaw = useSessionQuery(api.backlog.listBacklogItems, {
    chatroomId,
    statusFilter: 'pending_user_review',
    limit: 100,
  });
  const pendingReviewBacklogItems = useMemo(
    () => (pendingReviewBacklogItemsRaw ?? []) as BacklogItem[],
    [pendingReviewBacklogItemsRaw]
  );

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
  const enqueueMessageAtFront = useSessionMutation(api.messages.enqueueMessageAtFront);
  const handleQueueFrontSubmit = useCallback(
    async (content: string) => {
      await enqueueMessageAtFront({ chatroomId, content });
      toast.success('Message added to front of queue');
    },
    [chatroomId, enqueueMessageAtFront]
  );
  // TODO: remove once convex codegen catches up
  const completeAllPendingReview = useSessionMutation(
    api.backlog.completeAllPendingReviewBacklogItems
  );
  const promoteNextTask = useSessionMutation(api.tasks.promoteNextTask);
  const updateUserMessageOrTask = useSessionMutation(api.messages.updateUserMessageOrTask);
  const completeTaskById = useSessionMutation(api.tasks.completeTaskById);
  const deleteUserMessageOrTask = useSessionMutation(api.messages.deleteUserMessageOrTask);
  // Note: cancelTask mutation was removed in Phase 3 backlog cleanup

  // Queued messages mutations
  const { deleteQueuedMessage: handleQueuedDelete } = useQueuedMessageActions();

  // Fetch queued messages
  const queuedMessagesRaw = useSessionQuery(api.messages.listQueued, {
    chatroomId,
  });
  const queuedMessages = (queuedMessagesRaw ?? []) as Message[];

  const teamSupportsEnhancerFlag = !teamRolesLoading && teamSupportsEnhancer(teamId, teamRoles);

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
        chatroomId,
        content,
        createdBy: 'user',
      });
    },
    [createBacklogItem, chatroomId]
  );

  const handlePromoteNext = useCallback(async () => {
    try {
      await promoteNextTask({
        chatroomId,
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
        await updateUserMessageOrTask({
          type: 'task',
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
    [updateUserMessageOrTask]
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

  const handleModalDelete = useCallback(
    async (taskId: string) => {
      await deleteUserMessageOrTask({
        type: 'task',
        taskId: taskId as Id<'chatroom_tasks'>,
      });
    },
    [deleteUserMessageOrTask]
  );

  // Batch close all acknowledged tasks (force complete)
  const handleCloseAllAcknowledged = useCallback(async () => {
    if (!categorizedTasks.current) return;

    // Filter for acknowledged tasks
    const acknowledgedTasks = categorizedTasks.current.filter((t) => t.status === 'acknowledged');

    if (acknowledgedTasks.length === 0) {
      console.warn('No acknowledged tasks to close');
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
      console.warn(`Closed ${acknowledgedTasks.length} acknowledged tasks`);
    } catch (error) {
      console.error('Failed to close all acknowledged tasks:', error);
    }
  }, [categorizedTasks, completeTaskById]);

  const handleMarkAllReviewed = useCallback(async () => {
    try {
      const result = await completeAllPendingReview({
        chatroomId,
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
        <button
          type="button"
          onClick={() => setIsQueueFrontModalOpen(true)}
          className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
          aria-label="Add message to front of queue"
          title="Add message to front of queue"
          data-testid="queue-front-add-button"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Scrollable Task List Container */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Queue Health Warning - Show when promotion needed */}
        {effectiveNeedsPromotion && (
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

        <SidebarSection.Root
          title="Current"
          count={categorizedTasks.current.length}
          icon={CircleDot}
          iconClassName="text-chatroom-accent"
          emptyMessage="No current tasks"
          viewMoreCount={Math.max(0, categorizedTasks.current.length - SIDEBAR_PREVIEW_LIMIT)}
          onViewMore={() => setIsCurrentTasksModalOpen(true)}
          action={
            categorizedTasks.current.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  type="button"
                  className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors p-1"
                  title="Actions"
                >
                  <MoreHorizontal size={14} />
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
            ) : undefined
          }
        >
          {categorizedTasks.current.slice(0, SIDEBAR_PREVIEW_LIMIT).map((task) => (
            <TaskItem
              key={task._id}
              task={task}
              isProtected
              onClick={() => handleOpenTaskDetail(task)}
              showCancelEnhancer={task.assignedTo === 'enhancer' && isEnhancing}
              onCancelEnhancer={cancelJob}
              isCancellingEnhancer={isCancelling}
            />
          ))}
        </SidebarSection.Root>

        <SidebarSection.Root
          title="Queued"
          count={queuedMessages.length}
          icon={Clock}
          iconClassName="text-orange-600 dark:text-orange-400"
          emptyMessage="No queued messages"
          viewMoreCount={Math.max(0, queuedMessages.length - SIDEBAR_PREVIEW_LIMIT)}
          onViewMore={() => setIsQueuedMessagesModalOpen(true)}
          action={
            <button
              type="button"
              onClick={() => setIsQueueFrontModalOpen(true)}
              className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
              aria-label="Add message to front of queue"
              title="Add message to front of queue"
              data-testid="queue-front-add-button"
            >
              <Plus size={14} />
            </button>
          }
        >
          {queuedMessages.slice(0, SIDEBAR_PREVIEW_LIMIT).map((message) => (
            <QueuedMessageItem
              key={message._id}
              chatroomId={chatroomId}
              message={message}
              teamSupportsEnhancer={teamSupportsEnhancerFlag}
              onDelete={handleQueuedDelete}
            />
          ))}
        </SidebarSection.Root>

        <SidebarSection.Root
          title="Pending Review"
          count={pendingReviewBacklogItems.length}
          icon={ClipboardCheck}
          iconClassName="text-violet-500 dark:text-violet-400"
          emptyMessage="No items pending review"
          viewMoreCount={Math.max(0, pendingReviewBacklogItems.length - SIDEBAR_PREVIEW_LIMIT)}
          onViewMore={() => setIsPendingReviewModalOpen(true)}
          action={
            pendingReviewBacklogItems.length > 0 ? (
              <button
                onClick={handleMarkAllReviewed}
                className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
                title="Mark all as reviewed"
              >
                <CheckCheck size={14} />
              </button>
            ) : undefined
          }
        >
          {pendingReviewBacklogItems.slice(0, SIDEBAR_PREVIEW_LIMIT).map((item) => (
            <PendingReviewBacklogItem
              key={item._id}
              item={item}
              onClick={() => setSelectedBacklogItemId(item._id)}
            />
          ))}
        </SidebarSection.Root>

        <SidebarSection.Root
          title="Backlog"
          count={categorizedTasks.backlog.length}
          icon={List}
          emptyMessage="No backlog items"
          viewMoreCount={Math.max(0, categorizedTasks.backlog.length - SIDEBAR_PREVIEW_LIMIT)}
          onViewMore={() => setIsBacklogQueueModalOpen(true)}
          action={
            <button
              onClick={() => setIsBacklogCreateModalOpen(true)}
              className="text-chatroom-accent hover:text-chatroom-text-primary transition-colors"
              title="Add to backlog"
            >
              <Plus size={14} />
            </button>
          }
        >
          {categorizedTasks.backlog.slice(0, SIDEBAR_PREVIEW_LIMIT).map((item) => (
            <CompactBacklogItem
              key={item._id}
              item={item}
              onClick={() => setSelectedBacklogItemId(item._id)}
            />
          ))}
        </SidebarSection.Root>
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
          onDelete={handleModalDelete}
          onForceComplete={handleModalForceComplete}
        />
      )}

      {/* Review Panel — Split-pane layout for pending review items */}
      <ReviewPanel
        isOpen={isPendingReviewModalOpen}
        onClose={() => setIsPendingReviewModalOpen(false)}
        chatroomId={chatroomId}
      />

      {/* Current Tasks Modal */}
      {isCurrentTasksModalOpen && (
        <CurrentTasksModal
          tasks={categorizedTasks.current}
          onClose={() => setIsCurrentTasksModalOpen(false)}
          onTaskClick={(task) => {
            handleOpenTaskDetail(task);
          }}
          onCancelEnhancer={cancelJob}
          isCancellingEnhancer={isCancelling}
        />
      )}

      {/* Backlog Create Modal */}
      <BacklogCreateModal
        isOpen={isBacklogCreateModalOpen}
        onClose={() => setIsBacklogCreateModalOpen(false)}
        onSubmit={handleAddTask}
      />
      <QueueFrontMessageModal
        isOpen={isQueueFrontModalOpen}
        onClose={() => setIsQueueFrontModalOpen(false)}
        onSubmit={handleQueueFrontSubmit}
      />

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

      {/* Backlog item detail portals after queue so it stacks above the queue modal */}
      {selectedBacklogItem && (
        <BacklogItemDetailModal
          isOpen={true}
          item={selectedBacklogItem}
          onClose={() => setSelectedBacklogItemId(null)}
        />
      )}

      {isQueuedMessagesModalOpen && (
        <QueuedMessagesModal
          chatroomId={chatroomId}
          messages={queuedMessages}
          teamSupportsEnhancer={teamSupportsEnhancerFlag}
          onClose={() => setIsQueuedMessagesModalOpen(false)}
          onDelete={handleQueuedDelete}
        />
      )}
    </div>
  );
}
