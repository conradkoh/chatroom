/**
 * Attachment kinds that have delivery renderers (task-read + primary delivery).
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end attachment guide (canonical)
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

/**
 * Kinds rendered in primary task delivery (`<attachments>` XML alongside task content).
 * Add new kinds here AND in PRIMARY_DELIVERY_INPUT_KEY_BY_KIND — compiler enforces exhaustiveness.
 */
// fallow-ignore-next-line unused-export
export const PRIMARY_DELIVERY_ATTACHMENT_KINDS = ['backlog', 'snippet'] as const;
export type PrimaryDeliveryAttachmentKind = (typeof PRIMARY_DELIVERY_ATTACHMENT_KINDS)[number];

/** Maps each primary-delivery kind → DeliveryAttachmentsInput field. Must stay exhaustive. */
// fallow-ignore-next-line unused-export
export const PRIMARY_DELIVERY_INPUT_KEY_BY_KIND = {
  backlog: 'attachedBacklogItems',
  snippet: 'attachedSnippets',
} as const satisfies Record<PrimaryDeliveryAttachmentKind, keyof DeliveryAttachmentsInput>;

export type PrimaryDeliveryAttachments = Pick<
  DeliveryAttachmentsInput,
  (typeof PRIMARY_DELIVERY_INPUT_KEY_BY_KIND)[PrimaryDeliveryAttachmentKind]
>;

/** Maps schema fields → delivery kind. Add new fields here before enabling delivery. */
// fallow-ignore-next-line unused-export
export const DELIVERY_ATTACHMENT_FIELD_MAP = {
  attachedBacklogItemIds: 'backlog',
  attachedMessageIds: 'message',
  attachedSnippets: 'snippet',
  attachedArtifactIds: 'artifact', // reserved — no renderer yet
} as const satisfies Record<MessageAttachmentField, MessageAttachmentKind | 'artifact'>;

export interface DeliveryAttachmentRenderContext {
  chatroomId: string;
  role: string;
  /** 'cli' | 'native' reserved for future format differences; unused in Phase 1 */
  mode?: 'cli' | 'native' | 'task-read';
}
