'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * Maximum number of attachments that can be added to a single message.
 * This limit applies to the combined total across all attachment types.
 */
export const MAX_ATTACHMENTS = 10;

// ── Attachment types (discriminated union) ─────────────────────────────────

export type TaskAttachment = {
  type: 'task';
  id: Id<'chatroom_tasks'>;
  content: string;
};

export type BacklogAttachment = {
  type: 'backlog';
  id: Id<'chatroom_backlog'>;
  content: string;
};

export type MessageAttachment = {
  type: 'message';
  id: Id<'chatroom_messages'>;
  content: string;
  senderRole: string;
};

/** Discriminated union of all supported attachment types. */
export type Attachment = TaskAttachment | BacklogAttachment | MessageAttachment;

// ── Context interface ──────────────────────────────────────────────────────

/**
 * Context value interface for the attachments registry.
 * Uses a single generic attachment list to support any number of attachment types.
 */
interface AttachmentsContextValue {
  /** All current attachments (tasks + backlog items + future types) */
  attachments: Attachment[];
  /** Total count of all attachments */
  totalCount: number;
  /** Whether more attachments can be added (under MAX_ATTACHMENTS limit) */
  canAddMore: boolean;
  /** Add an attachment. Returns false if limit reached or already attached. */
  add: (attachment: Attachment) => boolean;
  /** Remove an attachment by type + id */
  remove: (type: Attachment['type'], id: string) => void;
  /** Check if a specific attachment is already attached */
  isAttached: (type: Attachment['type'], id: string) => boolean;
  /** Clear all attachments */
  clearAll: () => void;
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

/**
 * Provider component for the attachments registry.
 * Wrap ChatroomDashboard or similar parent component with this provider.
 */
export function AttachmentsProvider({ children }: { children: React.ReactNode }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const totalCount = attachments.length;
  const canAddMore = totalCount < MAX_ATTACHMENTS;

  const isAttached = useCallback(
    (type: Attachment['type'], id: string): boolean => {
      return attachments.some((a) => a.type === type && a.id === id);
    },
    [attachments]
  );

  const add = useCallback(
    (attachment: Attachment): boolean => {
      // Check if already attached (dedup by type + id)
      if (isAttached(attachment.type, attachment.id)) {
        return false;
      }
      // Check limit
      if (attachments.length >= MAX_ATTACHMENTS) {
        return false;
      }
      setAttachments((prev) => [...prev, attachment]);
      return true;
    },
    [attachments.length, isAttached]
  );

  const remove = useCallback((type: Attachment['type'], id: string) => {
    setAttachments((prev) => prev.filter((a) => !(a.type === type && a.id === id)));
  }, []);

  const clearAll = useCallback(() => {
    setAttachments([]);
  }, []);

  const value = useMemo(
    () => ({
      attachments,
      totalCount,
      canAddMore,
      add,
      remove,
      isAttached,
      clearAll,
    }),
    [attachments, totalCount, canAddMore, add, remove, isAttached, clearAll]
  );

  return <AttachmentsContext.Provider value={value}>{children}</AttachmentsContext.Provider>;
}

// ── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Hook to access the full attachments context.
 * Must be used within an AttachmentsProvider.
 */
export function useAttachments(): AttachmentsContextValue {
  const context = useContext(AttachmentsContext);
  if (!context) {
    throw new Error('useAttachments must be used within an AttachmentsProvider');
  }
  return context;
}

/**
 * Selector hook — returns only the task attachments from the registry.
 * Pure derived state; does not add to the context interface.
 */
export function useTaskAttachments(): TaskAttachment[] {
  const { attachments } = useAttachments();
  return attachments.filter((a): a is TaskAttachment => a.type === 'task');
}

/**
 * Selector hook — returns only the backlog item attachments from the registry.
 * Pure derived state; does not add to the context interface.
 */
export function useBacklogAttachments(): BacklogAttachment[] {
  const { attachments } = useAttachments();
  return attachments.filter((a): a is BacklogAttachment => a.type === 'backlog');
}

/**
 * Selector hook — returns only the message attachments from the registry.
 * Pure derived state; does not add to the context interface.
 */
export function useMessageAttachments(): MessageAttachment[] {
  const { attachments } = useAttachments();
  return attachments.filter((a): a is MessageAttachment => a.type === 'message');
}
