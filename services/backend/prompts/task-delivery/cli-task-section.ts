/**
 * CLI-specific task section for get-next-task delivery.
 */

import { renderTaskEnvelopeLines } from './render-task-envelope.js';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments.js';
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

export function appendCliTaskSection(lines: string[], params: CliTaskSectionParams): void {
  lines.push(
    ...renderTaskEnvelopeLines({
      ...params,
      deliveryMode: 'cli',
      intakeNote: getTokenActivityInProgressNote(),
    })
  );
}

export function appendCliTaskDeliveryFooter(
  lines: string[],
  params: Pick<CliTaskSectionParams, 'chatroomId' | 'role' | 'cliEnvPrefix'>
): void {
  const { chatroomId, role, cliEnvPrefix } = params;
  lines.push('', SEP_EQUAL, getNextTaskReminder());
  lines.push(getCompactionRecoveryOneLiner({ cliEnvPrefix, chatroomId, role }), SEP_EQUAL);
}
