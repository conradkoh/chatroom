/**
 * Attachment kinds that have delivery renderers (task-read + future primary delivery).
 * @see ../../../prompts/attachments/attachments-guide-content.ts — end-to-end attachment guide
 */
// fallow-ignore-next-line unused-export
export const MESSAGE_ATTACHMENT_KINDS = ['backlog', 'snippet', 'message'] as const;
export type MessageAttachmentKind = (typeof MESSAGE_ATTACHMENT_KINDS)[number];

/** Schema fields on chatroom_messages / messageQueue that store attachments. */
export type MessageAttachmentField =
  | 'attachedBacklogItemIds'
  | 'attachedMessageIds'
  | 'attachedSnippets'
  | 'attachedArtifactIds';

/** Maps schema fields → delivery kind. Add new fields here before enabling delivery. */
// fallow-ignore-next-line unused-export
export const DELIVERY_ATTACHMENT_FIELD_MAP = {
  attachedBacklogItemIds: 'backlog',
  attachedMessageIds: 'message',
  attachedSnippets: 'snippet',
  attachedArtifactIds: 'artifact', // reserved — no renderer yet
} as const satisfies Record<MessageAttachmentField, MessageAttachmentKind | 'artifact'>;

/** Resolved attachment payloads passed to renderers. */
export interface DeliveryBacklogItem {
  _id: string;
  content: string;
  status: string;
}

export interface DeliverySnippet {
  reference: string;
  fileSource: string;
  selectedContent: string;
}

export interface DeliveryAttachedMessage {
  _id: string;
  content: string;
  senderRole: string;
}

export interface DeliveryAttachmentsInput {
  attachedBacklogItems?: DeliveryBacklogItem[];
  attachedSnippets?: DeliverySnippet[];
  attachedMessages?: DeliveryAttachedMessage[];
}

export interface DeliveryAttachmentRenderContext {
  chatroomId: string;
  role: string;
  /** 'cli' | 'native' reserved for future format differences; unused in Phase 1 */
  mode?: 'cli' | 'native' | 'task-read';
}
