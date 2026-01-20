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
 * Context value interface for attached tasks state management.
 */
interface AttachedTasksContextValue {
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
}

const AttachedTasksContext = createContext<AttachedTasksContextValue | null>(null);

/**
 * Provider component for attached tasks state.
 * Wrap ChatroomDashboard or similar parent component with this provider.
 */
export function AttachedTasksProvider({ children }: { children: React.ReactNode }) {
  const [attachedTasks, setAttachedTasks] = useState<AttachedTask[]>([]);

  const canAddMore = attachedTasks.length < MAX_ATTACHMENTS;

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
      if (attachedTasks.length >= MAX_ATTACHMENTS) {
        return false;
      }

      setAttachedTasks((prev) => [...prev, task]);
      return true;
    },
    [attachedTasks.length, isTaskAttached]
  );

  const removeTask = useCallback((taskId: Id<'chatroom_tasks'>) => {
    setAttachedTasks((prev) => prev.filter((task) => task._id !== taskId));
  }, []);

  const clearTasks = useCallback(() => {
    setAttachedTasks([]);
  }, []);

  const value = useMemo(
    () => ({
      attachedTasks,
      addTask,
      removeTask,
      clearTasks,
      canAddMore,
      isTaskAttached,
    }),
    [attachedTasks, addTask, removeTask, clearTasks, canAddMore, isTaskAttached]
  );

  return <AttachedTasksContext.Provider value={value}>{children}</AttachedTasksContext.Provider>;
}

/**
 * Hook to access attached tasks context.
 * Must be used within an AttachedTasksProvider.
 */
export function useAttachedTasks(): AttachedTasksContextValue {
  const context = useContext(AttachedTasksContext);
  if (!context) {
    throw new Error('useAttachedTasks must be used within an AttachedTasksProvider');
  }
  return context;
}
