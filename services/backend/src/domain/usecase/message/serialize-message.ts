import { renderDeliveryAttachmentsBlock } from '../../../../prompts/attachments/render-delivery-attachments';
import { escapeXmlAttribute, escapeXmlText } from '../../../../prompts/attachments/xml';
import type { Message } from '../../entities/message';
import type { DeliveryAttachmentsInput } from '../../entities/message-attachments';

export type MessageSerializationProfile = 'linear' | 'context-xml' | 'task-origin';
export interface SerializeMessageOptions {
  profile: MessageSerializationProfile;
  chatroomId?: string | undefined;
  role?: string | undefined;
  indent?: string | undefined;
}

function attachmentContext(options: SerializeMessageOptions) {
  return { chatroomId: options.chatroomId ?? '', role: options.role ?? '' };
}

/**
 * Normalizes the message's flat wire attachments to the renderer input.
 * The wire shape is canonical: `attachedTasks` carries `backlogStatus` and
 * `attachedBacklogItems` carries `id`.
 */
function normalizeDeliveryAttachments(message: Message): DeliveryAttachmentsInput | undefined {
  const attachments: DeliveryAttachmentsInput = {
    attachedTasks: message.attachedTasks?.map((item) => ({
      _id: item._id,
      content: item.content,
      status: item.backlogStatus ?? '',
    })),
    attachedBacklogItems: message.attachedBacklogItems?.map((item) => ({
      _id: item.id,
      content: item.content,
      status: item.status,
    })),
    attachedMessages: message.attachedMessages?.map((item) => ({
      _id: item._id,
      content: item.content,
      senderRole: item.senderRole,
    })),
    attachedSnippets: message.attachedSnippets,
  };
  return Object.values(attachments).some((items) => items && items.length > 0)
    ? attachments
    : undefined;
}

/**
 * Linear header suffix for a handoff snapshot: ` | harness=<h>[ model=<m>]`, or '' when absent.
 * Linear profile only: `context-xml` and `task-origin` deliberately omit the snapshot.
 */
function linearSenderAgentSuffix(senderAgent: Message['senderAgent']): string {
  if (!senderAgent) return '';
  const model = senderAgent.model ? ` model=${senderAgent.model}` : '';
  return ` | harness=${senderAgent.harness}${model}`;
}

/** Linear attachments block, including its trailing newline when non-empty. */
function linearAttachments(message: Message, options: SerializeMessageOptions): string {
  const attachments = normalizeDeliveryAttachments(message);
  if (!attachments) return '';
  const block = renderDeliveryAttachmentsBlock(attachments, attachmentContext(options)).join('\n');
  return block ? `${block}\n` : '';
}

function serializeLinearMessage(message: Message, options: SerializeMessageOptions): string {
  const target = message.targetRole ? ` → ${message.targetRole}` : '';
  // Header order: type tag first (intrinsic to the message), then the sender-agent snapshot.
  const typeTag =
    message.type === 'plan' || message.type === 'grounding' ? ` | type=${message.type}` : '';
  const header = `${new Date(message._creationTime).toISOString()} | ${message.senderRole}${target}${typeTag}${linearSenderAgentSuffix(message.senderAgent)}`;
  return `${header}\n${linearAttachments(message, options)}\n${message.content}`;
}

function serializeTaskOriginMessage(message: Message): string {
  return `<message sender="${escapeXmlAttribute(message.senderRole)}" message-id="${escapeXmlAttribute(message._id)}">\n<message-content>\n${escapeXmlText(message.content)}\n</message-content>\n</message>`;
}

function serializeContextXmlMessage(message: Message, options: SerializeMessageOptions): string {
  const indent = options.indent ?? '   ';
  const attrs = contextMessageAttributes(message);
  const task = contextTaskBlock(message, indent);
  const attachmentLines = contextAttachmentLines(message, options, indent);
  return [
    `<message ${attrs}>`,
    task,
    ...attachmentLines,
    `${indent}Content:`,
    `${indent}<message-content>`,
    `${indent}${indent}${escapeXmlText(message.content)}`,
    `${indent}</message-content>`,
    `</message>`,
  ]
    .filter(Boolean)
    .join('\n');
}

function contextMessageAttributes(message: Message): string {
  const target = message.targetRole ? ` to="${escapeXmlAttribute(message.targetRole)}"` : '';
  return `id="${escapeXmlAttribute(message._id)}" from="${escapeXmlAttribute(message.senderRole)}"${target} type="${escapeXmlAttribute(message.type)}"`;
}

function contextTaskBlock(message: Message, indent: string): string {
  if (!message.task) return '';
  return `\n${indent}<task id="${escapeXmlAttribute(message.task._id)}" status="${escapeXmlAttribute(message.task.status)}">\n${indent}${indent}${escapeXmlText(message.task.content)}\n${indent}</task>`;
}

function contextAttachmentLines(
  message: Message,
  options: SerializeMessageOptions,
  indent: string
): string[] {
  const attachments = normalizeDeliveryAttachments(message);
  if (!attachments) return [];
  return renderDeliveryAttachmentsBlock(attachments, attachmentContext(options)).map((line) =>
    line ? indent + line : ''
  );
}

export function serializeMessage(message: Message, options: SerializeMessageOptions): string {
  switch (options.profile) {
    case 'linear':
      return serializeLinearMessage(message, options);
    case 'task-origin':
      return serializeTaskOriginMessage(message);
    case 'context-xml':
      return serializeContextXmlMessage(message, options);
  }
}
