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

export function toSerializableMessage(input: EnrichedMessageInput): SerializableMessage {
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
  const hasAttachments = Object.values(attachments).some((items) => items && items.length > 0);
  return {
    _id: input._id,
    _creationTime: input._creationTime,
    senderRole: input.senderRole,
    targetRole: input.targetRole,
    type: input.type,
    content: input.content,
    ...(hasAttachments ? { attachments } : {}),
    ...(input.taskId && input.taskStatus != null && input.taskContent != null
      ? { task: { _id: input.taskId, status: input.taskStatus, content: input.taskContent } }
      : {}),
  };
}
