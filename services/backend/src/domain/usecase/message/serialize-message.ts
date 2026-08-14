import { renderDeliveryAttachmentsBlock } from '../../../../prompts/attachments/render-delivery-attachments';
import { escapeXmlAttribute, escapeXmlText } from '../../../../prompts/attachments/xml';
import type { SerializableMessage } from '../../entities/serializable-message';

export type MessageSerializationProfile = 'linear' | 'context-xml' | 'task-origin';
export interface SerializeMessageOptions {
  profile: MessageSerializationProfile;
  chatroomId?: string;
  role?: string;
  indent?: string;
}

export function serializeMessage(
  message: SerializableMessage,
  options: SerializeMessageOptions
): string {
  if (options.profile === 'linear') {
    const target = message.targetRole ? ` → ${message.targetRole}` : '';
    const attachments = message.attachments
      ? renderDeliveryAttachmentsBlock(message.attachments, {
          chatroomId: options.chatroomId ?? '',
          role: options.role ?? '',
        }).join('\n')
      : '';
    return `${new Date(message._creationTime).toISOString()} | ${message.senderRole}${target}\n${attachments ? `${attachments}\n` : ''}\n${message.content}`;
  }
  if (options.profile === 'task-origin') {
    return `<message sender="${escapeXmlAttribute(message.senderRole)}" message-id="${escapeXmlAttribute(message._id)}">\n<message-content>\n${escapeXmlText(message.content)}\n</message-content>\n</message>`;
  }
  const indent = options.indent ?? '   ';
  const attrs = `id="${escapeXmlAttribute(message._id)}" from="${escapeXmlAttribute(message.senderRole)}"${message.targetRole ? ` to="${escapeXmlAttribute(message.targetRole)}"` : ''} type="${escapeXmlAttribute(message.type)}"`;
  const task = message.task
    ? `\n${indent}<task id="${escapeXmlAttribute(message.task._id)}" status="${escapeXmlAttribute(message.task.status)}">\n${indent}${indent}${escapeXmlText(message.task.content)}\n${indent}</task>`
    : '';
  const attachmentLines = message.attachments
    ? renderDeliveryAttachmentsBlock(message.attachments, {
        chatroomId: options.chatroomId ?? '',
        role: options.role ?? '',
      }).map((line) => (line ? indent + line : ''))
    : [];
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
