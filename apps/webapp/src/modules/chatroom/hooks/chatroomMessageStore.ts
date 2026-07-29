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
    scheduledPromptId: m.scheduledPromptId,
  };
}

// ─── State ─────────────────────────────────────────────────────────────────

export interface ChatroomMessageStoreState {
  messages: Message[];
  tailAfterCreationTime: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  taskStatusAfterKey: string | null;
}

export const chatroomMessageStoreInitialState: ChatroomMessageStoreState = {
  messages: [],
  tailAfterCreationTime: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
  taskStatusAfterKey: null,
};

// ─── Actions ───────────────────────────────────────────────────────────────

export interface TaskStatusSignal {
  taskId: string;
  taskStatus: Message['taskStatus'];
  signalKey: string;
}

export type ChatroomMessageStoreAction =
  | {
      type: 'INITIALIZE';
      messages: Message[];
      tailAfterCreationTime: number;
      hasMoreOlder: boolean;
      taskStatusAfterKey: string;
    }
  | { type: 'MERGE_TAIL'; messages: Message[] }
  | { type: 'PREPEND_OLDER'; messages: Message[]; hasMoreOlder: boolean }
  | { type: 'LOAD_OLDER_START' }
  | { type: 'LOAD_OLDER_FAILED' }
  | { type: 'RESET' }
  | {
      type: 'APPLY_TASK_STATUS_SIGNALS';
      signals: TaskStatusSignal[];
      highKey: string | null;
    }
  | { type: 'REMOVE_BY_TASK_ID'; taskId: string }
  | { type: 'TRIM_TO_INITIAL_WINDOW' };

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

// ─── Public pure helpers used by the reducer and tests ──────────────────────

// fallow-ignore-next-line unused-export
export function applyTaskStatusSignals(
  existing: Message[],
  signals: TaskStatusSignal[]
): Message[] {
  if (signals.length === 0) return existing;
  const byTaskId = new Map(signals.map((s) => [s.taskId, s]));
  let changed = false;
  const next = existing.map((m) => {
    if (!m.taskId) return m;
    const signal = byTaskId.get(m.taskId);
    if (!signal || m.taskStatus === signal.taskStatus) return m;
    changed = true;
    return { ...m, taskStatus: signal.taskStatus };
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
        taskStatusAfterKey: action.taskStatusAfterKey,
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
    case 'APPLY_TASK_STATUS_SIGNALS': {
      if (!state.isInitialized) return state;
      const nextMessages = applyTaskStatusSignals(state.messages, action.signals);
      const nextKey =
        action.highKey && action.signals.length > 0 ? action.highKey : state.taskStatusAfterKey;
      if (nextMessages === state.messages && nextKey === state.taskStatusAfterKey) return state;
      return {
        ...state,
        messages: nextMessages,
        taskStatusAfterKey: nextKey,
      };
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
      return {
        ...chatroomMessageStoreInitialState,
        taskStatusAfterKey: null,
      };
    default:
      return state;
  }
}
