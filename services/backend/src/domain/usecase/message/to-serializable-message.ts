import type { DeliveryAttachmentsInput } from '../../entities/message-attachments';
import type { SerializableMessage } from '../../entities/serializable-message';

export type EnrichedMessageInput = {
  _id: string;
  _creationTime: number;
  senderRole: string;
  targetRole?: string | null | undefined;
  type: string;
  content: string;
  taskId?: string | null | undefined;
  taskStatus?: string | null | undefined;
  taskContent?: string | null | undefined;
  attachedTasks?:
    | {
        _id: string;
        content: string;
        status?: string | undefined;
        backlogStatus?: string | undefined;
      }[]
    | undefined;
  attachedBacklogItems?:
    | { _id?: string | undefined; id?: string | undefined; content: string; status: string }[]
    | undefined;
  attachedMessages?: { _id: string; content: string; senderRole: string }[] | undefined;
  attachedSnippets?:
    { reference: string; fileSource: string; selectedContent: string }[] | undefined;
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
