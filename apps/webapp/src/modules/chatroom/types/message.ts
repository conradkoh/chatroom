import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';
import type {
  Message as DomainMessage,
  MessageSenderAgent,
  MessageType,
} from '@workspace/backend/src/domain/entities/message';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import type { ArtifactMeta } from '../components/ArtifactRenderer';

// Re-exported so feed consumers can name the wire vocabulary without importing the backend path.
// fallow-ignore-next-line unused-type
export type { MessageType };

/** Harness and model of the agent that sent a handoff. Informational only. */
export type SenderAgentSnapshot = MessageSenderAgent;

// fallow-ignore-next-line unused-type
export type AttachedBacklogItem = NonNullable<DomainMessage['attachedBacklogItems']>[number];
// fallow-ignore-next-line unused-type
export type AttachedMessage = NonNullable<DomainMessage['attachedMessages']>[number];
// fallow-ignore-next-line unused-type
export type AttachedSnippet = NonNullable<DomainMessage['attachedSnippets']>[number];
export type AttachedTask = Omit<
  NonNullable<DomainMessage['attachedTasks']>[number],
  'backlogStatus'
> & {
  backlogStatus?: TaskStatus;
};

/**
 * Message shape used throughout the chatroom feed UI: the canonical wire
 * message plus queue-only UI fields.
 *
 * The backend domain `Message` (`@workspace/backend/src/domain/entities/message`)
 * is the source of truth; this type only narrows `backlogStatus` and adds the
 * fields that exist solely on queued-message responses.
 */
export type Message = Omit<DomainMessage, 'attachedTasks' | 'attachedArtifacts'> & {
  attachedTasks?: AttachedTask[];
  attachedArtifacts?: ArtifactMeta[];
  /** Queued message flag (from chatroom_messageQueue). */
  isQueued?: boolean;
  startInNewSession?: boolean;
  conversationMode?: ConversationMode;
  /** Complete canonical policy snapshot for queued messages. */
  taskEnvelope?: TaskEnvelopeV1;
};
