import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import type { ArtifactMeta } from '../components/ArtifactRenderer';

// ─── Shared message types ──────────────────────────────────────────────────────
// Used by timeline hooks and the All-tab conversation to ensure a
// single source of truth for message shapes flowing through the cursor-based
// loading pipeline.

export interface AttachedTask {
  _id: string;
  content: string;
  backlogStatus?: TaskStatus;
}

export interface AttachedBacklogItem {
  id: string;
  content: string;
  status: string;
}

export interface AttachedMessage {
  _id: string;
  content: string;
  senderRole: string;
  _creationTime: number;
}

export interface AttachedSnippet {
  reference: string;
  fileSource: string;
  selectedContent: string;
}

/** Message shape used throughout the chatroom feed UI. */
export interface Message {
  startInNewSession?: boolean;
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  taskId?: string;
  /**
   * Task status for UI display. Includes backend TaskStatus values plus 'cancelled'
   * which is inferred client-side when tasks leave the active set unexpectedly.
   */
  taskStatus?: TaskStatus | 'cancelled';
  /** Source platform for messages from external integrations (e.g. 'telegram') */
  sourcePlatform?: string;
  /** Attached backlog tasks for context */
  attachedTasks?: AttachedTask[];
  /** Attached chatroom_backlog items for context (from "Attach to Context" button) */
  attachedBacklogItems?: AttachedBacklogItem[];
  /** Attached artifacts */
  attachedArtifacts?: ArtifactMeta[];
  /** Attached chatroom messages for context */
  attachedMessages?: AttachedMessage[];
  /** Explorer file snippets attached via Cmd+I */
  attachedSnippets?: AttachedSnippet[];
  /** Queued message flag (from chatroom_messageQueue) */
  isQueued?: boolean;
  /** Role that set the context (new-context messages only) */
  contextCreatedBy?: string;
  /** Original planner draft before enhancer (from job.draftContent); not stored on message row */
  enhancerOriginalContent?: string;
  /** Scheduled prompt ID that triggered this message */
  scheduledPromptId?: string;
  /** Snapshot of enhancer enabled at enqueue time (queued messages only) */
  plannerEnhancerEnabled?: boolean;
  /** Per-message conversation mode snapshot (queued messages only) */
  conversationMode?: ConversationMode;
}
