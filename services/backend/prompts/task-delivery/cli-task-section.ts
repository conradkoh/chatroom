/**
 * CLI-specific task section for get-next-task delivery.
 */

import { appendTaskDeliveryContextSection } from './context-staleness.js';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments.js';
import { renderDeliveryAttachmentsBlock } from '../attachments/render-delivery-attachments.js';
import { getTokenActivityInProgressNote } from '../base/shared/token-activity-note';
import { getCompactionRecoveryOneLiner, getNextTaskReminder } from '../cli/get-next-task/reminder';

const SEP_EQUAL = '='.repeat(60);

export interface CliTaskSectionParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  isEntryPoint: boolean;
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  currentContext: { elapsedHours: number } | null;
  originMessage: {
    senderRole: string;
  } | null;
  followUpCountSinceOrigin: number;
  originMessageCreatedAt: number | null;
  sourceAttachments?: PrimaryDeliveryAttachments;
}

// fallow-ignore-next-line complexity
export function appendCliTaskSection(lines: string[], params: CliTaskSectionParams): void {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    isEntryPoint,
    task,
    message,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    sourceAttachments,
  } = params;

  lines.push('<task>', SEP_EQUAL, '📋 CHATROOM TASK', SEP_EQUAL, `Task ID: ${task._id}`);
  if (message) {
    lines.push(`Origin Message ID: ${message._id}`, `From: ${message.senderRole}`);
  }

  appendTaskDeliveryContextSection(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    isEntryPoint,
    currentContext,
    originMessage: originMessage ? { senderRole: originMessage.senderRole } : null,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  });

  lines.push('', '## Chatroom task', task.content);
  lines.push(
    ...renderDeliveryAttachmentsBlock(sourceAttachments ?? {}, { chatroomId, role, mode: 'cli' })
  );
  lines.push('', getTokenActivityInProgressNote());
  lines.push('</task>');
}

export function appendCliTaskDeliveryFooter(
  lines: string[],
  params: Pick<CliTaskSectionParams, 'chatroomId' | 'role' | 'cliEnvPrefix'>
): void {
  const { chatroomId, role, cliEnvPrefix } = params;
  lines.push('', SEP_EQUAL, getNextTaskReminder());
  lines.push(getCompactionRecoveryOneLiner({ cliEnvPrefix, chatroomId, role }), SEP_EQUAL);
}
