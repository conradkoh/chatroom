/**
 * chatroomMessageStore — pure (no React) message store for the timeline.
 *
 * Contains the reducer, constants, and helper functions extracted from
 * useChatroomMessageStore. This module has zero React or Convex imports.
 */

import type { Message } from '../types/message';

// ─── Constants ─────────────────────────────────────────────────────────────

export const MESSAGE_STORE_LIMIT = 5;
export const MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE = 5;
/** How many of the most-recent messages to keep "live" for status/progress updates. */
export const VISIBLE_UPDATE_WINDOW = 30;

// ─── Pure helpers ──────────────────────────────────────────────────────────

/** Match legacy useMessages: a full initial window implies more history may exist. */
export function inferHasMoreOlder(messageCount: number, hasMoreFromServer: boolean): boolean {
  return hasMoreFromServer || messageCount >= MESSAGE_STORE_LIMIT;
}

// fallow-ignore-next-line unused-export
export function trimMessagesToInitialWindow(messages: Message[]): Message[] {
  if (messages.length <= MESSAGE_STORE_LIMIT) return messages;
  return messages.slice(-MESSAGE_STORE_LIMIT);
}

/** History is exhausted only when the server returns zero rows for a page. */
export function hasMoreOlderAfterPage(pageLength: number): boolean {
  return pageLength > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMessage(m: any): Message {
  return {
    _id: m._id,
    type: m.type,
    senderRole: m.senderRole,
    targetRole: m.targetRole,
    content: m.content,
    _creationTime: m._creationTime,
    classification: m.classification,
    taskId: m.taskId,
    taskStatus: m.taskStatus,
    sourcePlatform: m.sourcePlatform,
    featureTitle: m.featureTitle,
    featureDescription: m.featureDescription,
    featureTechSpecs: m.featureTechSpecs,
    attachedTasks: m.attachedTasks,
    attachedBacklogItems: m.attachedBacklogItems,
    attachedArtifacts: m.attachedArtifacts,
    attachedMessages: m.attachedMessages,
    attachedSnippets: m.attachedSnippets,
    latestProgress: m.latestProgress,
    isQueued: m.isQueued,
    contextCreatedBy: m.contextCreatedBy,
    enhancerOriginalContent: m.enhancerOriginalContent,
  };
}

// ─── State ─────────────────────────────────────────────────────────────────

export interface ChatroomMessageStoreState {
  messages: Message[];
  tailAfterCreationTime: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
}

export const chatroomMessageStoreInitialState: ChatroomMessageStoreState = {
  messages: [],
  tailAfterCreationTime: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
};

// ─── Actions ───────────────────────────────────────────────────────────────

export type ChatroomMessageStoreAction =
  | {
      type: 'INITIALIZE';
      messages: Message[];
      tailAfterCreationTime: number;
      hasMoreOlder: boolean;
    }
  | { type: 'MERGE_TAIL'; messages: Message[] }
  | { type: 'PREPEND_OLDER'; messages: Message[]; hasMoreOlder: boolean }
  | { type: 'LOAD_OLDER_START' }
  | { type: 'LOAD_OLDER_FAILED' }
  | { type: 'RESET' }
  | { type: 'APPLY_VISIBLE_UPDATES'; updates: VisibleUpdate[] }
  | { type: 'REMOVE_BY_TASK_ID'; taskId: string }
  | { type: 'TRIM_TO_INITIAL_WINDOW' };

export interface VisibleUpdate {
  _id: Message['_id'];
  taskStatus?: Message['taskStatus'];
  latestProgress?: Message['latestProgress'];
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return existing;
  const idxById = new Map(existing.map((m, i) => [m._id, i]));
  const result = [...existing];
  for (const msg of incoming) {
    const idx = idxById.get(msg._id);
    if (idx !== undefined) {
      result[idx] = msg;
    } else {
      result.push(msg);
    }
  }
  result.sort((a, b) => a._creationTime - b._creationTime);
  return result;
}

export function filterNewMessages(existing: Message[], incoming: Message[]): Message[] {
  const existingIds = new Set(existing.map((m) => m._id));
  return incoming.filter((m) => !existingIds.has(m._id));
}

// fallow-ignore-next-line complexity
function sameProgress(a: Message['latestProgress'], b: Message['latestProgress']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.content === b.content && a.senderRole === b.senderRole && a._creationTime === b._creationTime
  );
}

// ─── Public pure helpers used by the reducer and tests ──────────────────────

// fallow-ignore-next-line unused-export
export function applyVisibleUpdates(existing: Message[], updates: VisibleUpdate[]): Message[] {
  if (updates.length === 0) return existing;
  const byId = new Map(updates.map((u) => [u._id, u]));
  let changed = false;
  const next = existing.map((m) => {
    const u = byId.get(m._id);
    if (!u) return m;
    if (m.taskStatus === u.taskStatus && sameProgress(m.latestProgress, u.latestProgress)) return m;
    changed = true;
    return { ...m, taskStatus: u.taskStatus, latestProgress: u.latestProgress };
  });
  return changed ? next : existing;
}

/** Evict all messages linked to a deleted task. */
// fallow-ignore-next-line unused-export
export function removeMessagesForTaskId(messages: Message[], taskId: string): Message[] {
  return messages.filter((m) => m.taskId !== taskId);
}

// ─── Reducer ───────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function chatroomMessageStoreReducer(
  state: ChatroomMessageStoreState,
  action: ChatroomMessageStoreAction
): ChatroomMessageStoreState {
  switch (action.type) {
    case 'INITIALIZE': {
      if (state.isInitialized) return state;
      return {
        ...state,
        messages: action.messages,
        tailAfterCreationTime: action.tailAfterCreationTime,
        isInitialized: true,
        hasMoreOlder: action.hasMoreOlder,
      };
    }
    case 'MERGE_TAIL': {
      if (!state.isInitialized) return state;
      const merged = mergeMessagesById(state.messages, action.messages);
      if (merged === state.messages) return state;
      return { ...state, messages: merged };
    }
    case 'PREPEND_OLDER': {
      if (action.messages.length === 0) {
        return {
          ...state,
          hasMoreOlder: action.hasMoreOlder,
          isLoadingOlder: false,
        };
      }
      const merged = [...action.messages, ...state.messages].sort(
        (a, b) => a._creationTime - b._creationTime
      );
      return {
        ...state,
        messages: merged,
        hasMoreOlder: action.hasMoreOlder,
        isLoadingOlder: false,
      };
    }
    case 'APPLY_VISIBLE_UPDATES': {
      if (!state.isInitialized) return state;
      const next = applyVisibleUpdates(state.messages, action.updates);
      if (next === state.messages) return state;
      return { ...state, messages: next };
    }
    case 'REMOVE_BY_TASK_ID': {
      if (!state.isInitialized) return state;
      const next = removeMessagesForTaskId(state.messages, action.taskId);
      if (next.length === state.messages.length) return state;
      return { ...state, messages: next };
    }
    case 'LOAD_OLDER_START':
      return state.isLoadingOlder ? state : { ...state, isLoadingOlder: true };
    case 'LOAD_OLDER_FAILED':
      return { ...state, isLoadingOlder: false };
    case 'TRIM_TO_INITIAL_WINDOW': {
      if (!state.isInitialized) return state;
      const trimmed = trimMessagesToInitialWindow(state.messages);
      if (trimmed.length === state.messages.length) return state;
      const tail = trimmed[trimmed.length - 1];
      if (!tail) return { ...state, messages: trimmed, hasMoreOlder: true };
      return {
        ...state,
        messages: trimmed,
        tailAfterCreationTime: tail._creationTime,
        hasMoreOlder: true,
        isLoadingOlder: false,
      };
    }
    case 'RESET':
      return chatroomMessageStoreInitialState;
    default:
      return state;
  }
}
