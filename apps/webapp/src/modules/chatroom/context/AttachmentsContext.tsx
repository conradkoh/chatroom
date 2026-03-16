'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * Maximum number of tasks that can be attached to a single message.
 * This limit is designed to be extensible for future attachment types (e.g., images).
 */
export const MAX_ATTACHMENTS = 10;

/**
 * Represents an attached task with minimal required fields.
 */
export interface AttachedTask {
  _id: Id<'chatroom_tasks'>;
  content: string;
}

/**
 * Represents an attached backlog item with minimal required fields.
 */
export interface AttachedBacklogItem {
  _id: Id<'chatroom_backlog'>;
  content: string;
}

/**
 * Context value interface for attachments state management.
 */
interface AttachmentsContextValue {
  /** Currently attached tasks */
  attachedTasks: AttachedTask[];
  /** Add a task to attachments. Returns false if limit reached or already attached. */
  addTask: (task: AttachedTask) => boolean;
  /** Remove a task from attachments by ID */
  removeTask: (taskId: Id<'chatroom_tasks'>) => void;
  /** Clear all attached tasks */
  clearTasks: () => void;
  /** Whether more tasks can be added (under limit) */
  canAddMore: boolean;
  /** Check if a specific task is already attached */
  isTaskAttached: (taskId: Id<'chatroom_tasks'>) => boolean;

  // Backlog item attachments
  /** Currently attached backlog items */
  attachedBacklogItems: AttachedBacklogItem[];
  /** Add a backlog item to attachments. Returns false if limit reached or already attached. */
  addBacklogItem: (item: AttachedBacklogItem) => boolean;
  /** Remove a backlog item from attachments by ID */
  removeBacklogItem: (itemId: Id<'chatroom_backlog'>) => void;
  /** Check if a specific backlog item is already attached */
  isBacklogItemAttached: (itemId: Id<'chatroom_backlog'>) => boolean;

  // Combined helpers
  /** Clear both tasks and backlog items */
  clearAll: () => void;
  /** Total count of all attachments (tasks + backlog items) */
  totalCount: number;
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

/**
 * Provider component for attached tasks state.
 * Wrap ChatroomDashboard or similar parent component with this provider.
 */
export function AttachmentsProvider({ children }: { children: React.ReactNode }) {
  const [attachedTasks, setAttachedTasks] = useState<AttachedTask[]>([]);
  const [attachedBacklogItems, setAttachedBacklogItems] = useState<AttachedBacklogItem[]>([]);

  const totalCount = attachedTasks.length + attachedBacklogItems.length;
  const canAddMore = totalCount < MAX_ATTACHMENTS;

  const isTaskAttached = useCallback(
    (taskId: Id<'chatroom_tasks'>) => {
      return attachedTasks.some((task) => task._id === taskId);
    },
    [attachedTasks]
  );

  const addTask = useCallback(
    (task: AttachedTask): boolean => {
      // Check if already attached
      if (isTaskAttached(task._id)) {
        return false;
      }

      // Check limit
      if (attachedTasks.length + attachedBacklogItems.length >= MAX_ATTACHMENTS) {
        return false;
      }

      setAttachedTasks((prev) => [...prev, task]);
      return true;
    },
    [attachedTasks.length, attachedBacklogItems.length, isTaskAttached]
  );

  const removeTask = useCallback((taskId: Id<'chatroom_tasks'>) => {
    setAttachedTasks((prev) => prev.filter((task) => task._id !== taskId));
  }, []);

  const clearTasks = useCallback(() => {
    setAttachedTasks([]);
  }, []);

  const isBacklogItemAttached = useCallback(
    (itemId: Id<'chatroom_backlog'>) => {
      return attachedBacklogItems.some((item) => item._id === itemId);
    },
    [attachedBacklogItems]
  );

  const addBacklogItem = useCallback(
    (item: AttachedBacklogItem): boolean => {
      // Check if already attached
      if (isBacklogItemAttached(item._id)) {
        return false;
      }

      // Check limit
      if (attachedTasks.length + attachedBacklogItems.length >= MAX_ATTACHMENTS) {
        return false;
      }

      setAttachedBacklogItems((prev) => [...prev, item]);
      return true;
    },
    [attachedTasks.length, attachedBacklogItems.length, isBacklogItemAttached]
  );

  const removeBacklogItem = useCallback((itemId: Id<'chatroom_backlog'>) => {
    setAttachedBacklogItems((prev) => prev.filter((item) => item._id !== itemId));
  }, []);

  const clearAll = useCallback(() => {
    setAttachedTasks([]);
    setAttachedBacklogItems([]);
  }, []);

  const value = useMemo(
    () => ({
      attachedTasks,
      addTask,
      removeTask,
      clearTasks,
      canAddMore,
      isTaskAttached,
      attachedBacklogItems,
      addBacklogItem,
      removeBacklogItem,
      isBacklogItemAttached,
      clearAll,
      totalCount,
    }),
    [
      attachedTasks,
      addTask,
      removeTask,
      clearTasks,
      canAddMore,
      isTaskAttached,
      attachedBacklogItems,
      addBacklogItem,
      removeBacklogItem,
      isBacklogItemAttached,
      clearAll,
      totalCount,
    ]
  );

  return <AttachmentsContext.Provider value={value}>{children}</AttachmentsContext.Provider>;
}

/**
 * Hook to access attached tasks context.
 * Must be used within an AttachmentsProvider.
 */
export function useAttachments(): AttachmentsContextValue {
  const context = useContext(AttachmentsContext);
  if (!context) {
    throw new Error('useAttachments must be used within an AttachmentsProvider');
  }
  return context;
}
