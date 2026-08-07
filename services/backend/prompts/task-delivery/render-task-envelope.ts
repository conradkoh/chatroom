/**
 * Shared <task> XML envelope renderer for CLI and native task delivery.
 */

import { appendStandingInstructionsSection } from './render-standing-instructions.js';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments.js';
import { renderDeliveryAttachmentsBlock } from '../attachments/render-delivery-attachments.js';
import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface TaskEnvelopeParams {
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  isEntryPoint: boolean;
  sourceAttachments?: PrimaryDeliveryAttachments;
  deliveryMode: 'cli' | 'native';
  /** CLI-only: token activity note rendered inside <task> */
  intakeNote?: string;
  standingInstructions?: string | null;
}

function taskOpenTag(params: Pick<TaskEnvelopeParams, 'task' | 'message'>): string {
  const attrs: string[] = [`task-id="${escapeXmlAttribute(params.task._id)}"`];
  if (params.message) {
    attrs.push(`origin-message-id="${escapeXmlAttribute(params.message._id)}"`);
    attrs.push(`sender="${escapeXmlAttribute(params.message.senderRole)}"`);
  }
  return `<task ${attrs.join(' ')}>`;
}

function renderOriginMessageBlock(
  message: { _id: string; senderRole: string } | null,
  content: string
): string[] {
  if (!content) return [];
  const senderAttr = message
    ? ` sender="${escapeXmlAttribute(message.senderRole)}" message-id="${escapeXmlAttribute(message._id)}"`
    : '';
  return [
    `<message${senderAttr}>`,
    '<message-content>',
    escapeXmlText(content),
    '</message-content>',
    '</message>',
  ];
}

/** Returns lines for full <task>...</task> envelope (including open/close tags). */
// fallow-ignore-next-line complexity
export function renderTaskEnvelopeLines(params: TaskEnvelopeParams): string[] {
  const lines: string[] = [taskOpenTag(params)];

  appendStandingInstructionsSection(lines, params.standingInstructions);

  lines.push(
    ...renderDeliveryAttachmentsBlock(params.sourceAttachments ?? {}, {
      chatroomId: params.chatroomId,
      role: params.role,
      mode: params.deliveryMode,
    })
  );

  lines.push(...renderOriginMessageBlock(params.message, params.task.content));

  if (params.intakeNote) {
    lines.push('<intake-note>', escapeXmlText(params.intakeNote), '</intake-note>');
  }

  lines.push('</task>');
  return lines;
}
