/**
 * chatroomMessageStore — shared timeline message constants and mapping helpers.
 *
 * Pure module with zero React or Convex imports.
 */

import type { Message } from '../types/message';

export const MESSAGE_STORE_LIMIT = 5;
export const MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE = 5;

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
    isQueued: m.isQueued,
    contextCreatedBy: m.contextCreatedBy,
    enhancerOriginalContent: m.enhancerOriginalContent,
    scheduledPromptId: m.scheduledPromptId,
  };
}
