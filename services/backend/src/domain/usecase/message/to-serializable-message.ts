import type { DeliveryAttachmentsInput } from '../../entities/message-attachments';
import type { SerializableMessage } from '../../entities/serializable-message';

export type EnrichedMessageInput = {
  _id: string;
  _creationTime: number;
  senderRole: string;
  targetRole?: string | null;
  type: string;
  content: string;
  taskId?: string | null;
  taskStatus?: string | null;
  taskContent?: string | null;
  attachedTasks?: { _id: string; content: string; status?: string; backlogStatus?: string }[];
  attachedBacklogItems?: { _id?: string; id?: string; content: string; status: string }[];
  attachedMessages?: { _id: string; content: string; senderRole: string }[];
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
};

function normalizeDeliveryAttachments(
  input: EnrichedMessageInput
): DeliveryAttachmentsInput | undefined {
  const attachments: DeliveryAttachmentsInput = {
    attachedTasks: input.attachedTasks?.map((item) => ({
      _id: item._id,
      content: item.content,
      status: item.status ?? item.backlogStatus ?? '',
    })),
    attachedBacklogItems: input.attachedBacklogItems?.map((item) => ({
      _id: item._id ?? item.id ?? '',
      content: item.content,
      status: item.status,
    })),
    attachedMessages: input.attachedMessages,
    attachedSnippets: input.attachedSnippets,
  };
  return Object.values(attachments).some((items) => items && items.length > 0)
    ? attachments
    : undefined;
}

function normalizeTask(input: EnrichedMessageInput): SerializableMessage['task'] | undefined {
  if (!input.taskId || input.taskStatus == null || input.taskContent == null) return undefined;
  return { _id: input.taskId, status: input.taskStatus, content: input.taskContent };
}

export function toSerializableMessage(input: EnrichedMessageInput): SerializableMessage {
  const attachments = normalizeDeliveryAttachments(input);
  return {
    _id: input._id,
    _creationTime: input._creationTime,
    senderRole: input.senderRole,
    targetRole: input.targetRole,
    type: input.type,
    content: input.content,
    ...(attachments ? { attachments } : {}),
    ...(normalizeTask(input) ? { task: normalizeTask(input) } : {}),
  };
}
