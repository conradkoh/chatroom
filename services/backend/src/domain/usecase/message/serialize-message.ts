import { renderDeliveryAttachmentsBlock } from '../../../../prompts/attachments/render-delivery-attachments';
import { escapeXmlAttribute, escapeXmlText } from '../../../../prompts/attachments/xml';
import type { SerializableMessage } from '../../entities/serializable-message';

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

function serializeLinearMessage(
  message: SerializableMessage,
  options: SerializeMessageOptions
): string {
  const target = message.targetRole ? ` → ${message.targetRole}` : '';
  const attachments = message.attachments
    ? renderDeliveryAttachmentsBlock(message.attachments, attachmentContext(options)).join('\n')
    : '';
  return `${new Date(message._creationTime).toISOString()} | ${message.senderRole}${target}\n${attachments ? `${attachments}\n` : ''}\n${message.content}`;
}

function serializeTaskOriginMessage(message: SerializableMessage): string {
  return `<message sender="${escapeXmlAttribute(message.senderRole)}" message-id="${escapeXmlAttribute(message._id)}">\n<message-content>\n${escapeXmlText(message.content)}\n</message-content>\n</message>`;
}

function serializeContextXmlMessage(
  message: SerializableMessage,
  options: SerializeMessageOptions
): string {
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

function contextMessageAttributes(message: SerializableMessage): string {
  const target = message.targetRole ? ` to="${escapeXmlAttribute(message.targetRole)}"` : '';
  return `id="${escapeXmlAttribute(message._id)}" from="${escapeXmlAttribute(message.senderRole)}"${target} type="${escapeXmlAttribute(message.type)}"`;
}

function contextTaskBlock(message: SerializableMessage, indent: string): string {
  if (!message.task) return '';
  return `\n${indent}<task id="${escapeXmlAttribute(message.task._id)}" status="${escapeXmlAttribute(message.task.status)}">\n${indent}${indent}${escapeXmlText(message.task.content)}\n${indent}</task>`;
}

function contextAttachmentLines(
  message: SerializableMessage,
  options: SerializeMessageOptions,
  indent: string
): string[] {
  if (!message.attachments) return [];
  return renderDeliveryAttachmentsBlock(message.attachments, attachmentContext(options)).map(
    (line) => (line ? indent + line : '')
  );
}

export function serializeMessage(
  message: SerializableMessage,
  options: SerializeMessageOptions
): string {
  switch (options.profile) {
    case 'linear':
      return serializeLinearMessage(message, options);
    case 'task-origin':
      return serializeTaskOriginMessage(message);
    case 'context-xml':
      return serializeContextXmlMessage(message, options);
  }
}
