/**
 * Shared task delivery sections: next steps, handoff templates, handoff targets.
 *
 * Used by both native and CLI task delivery paths.
 */

import type { TaskDeliveryContextWindow } from './context-staleness';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments.js';
import { handoffCommand } from '../cli/handoff/command';
import { inferPrimaryHandoffTarget } from '../utils/infer-primary-handoff-target';

export interface TaskDeliveryParams extends TaskDeliveryContextWindow {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  teamId?: string;
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  availableHandoffTargets: string[];
  attachedMessages?: { _id: string; content: string; senderRole: string }[];
  isEntryPoint?: boolean;
  sourceAttachments?: PrimaryDeliveryAttachments;
}

export { appendNativeDeliveryHandoffTemplates as appendTaskDeliveryHandoffTemplates } from '../native/delivery-handoff-templates';

export function appendTaskDeliveryNextSteps(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'message'
    | 'availableHandoffTargets'
    | 'task'
    | 'isEntryPoint'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, message, availableHandoffTargets, isEntryPoint } = params;
  const primaryTarget = inferPrimaryHandoffTarget({
    senderRole: message?.senderRole,
    role,
    availableHandoffTargets,
    isEntryPoint,
  });

  lines.push('');
  lines.push('<next-steps>');
  lines.push('1. Work on the task above.');

  if (primaryTarget) {
    const senderNote = message ? ` (task from \`${message.senderRole}\`)` : '';
    lines.push(
      `2. **When complete, you MUST run the handoff command** — this completes your work and delivers it to \`${primaryTarget}\`${senderNote}:`
    );
    lines.push('');
    lines.push('```bash');
    lines.push(handoffCommand({ chatroomId, role, nextRole: primaryTarget, cliEnvPrefix }));
    lines.push('```');
    lines.push('');
    lines.push(
      'Fill in the message using the matching template in `<handoff-templates>` below. Replace `[Your message here]` with the template content. The closing line must be exactly `CHATROOM_HANDOFF_END` (not `EOF`). **Do not end your turn without running handoff.**'
    );
  } else {
    lines.push(
      '2. **When complete, you MUST run a handoff command** from `<handoffs>` below. **Do not end your turn without running handoff.**'
    );
  }

  lines.push('');
  lines.push('</next-steps>');
}

export function appendTaskDeliveryHandoffTargets(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'availableHandoffTargets'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, availableHandoffTargets } = params;
  if (availableHandoffTargets.length === 0) return;

  lines.push('');
  lines.push('<handoffs>');
  lines.push('Other handoff targets (if you need a different recipient than step 2):');
  lines.push('');

  for (const target of availableHandoffTargets) {
    lines.push(`**${target}**`);
    lines.push('```bash');
    lines.push(handoffCommand({ chatroomId, role, nextRole: target, cliEnvPrefix }));
    lines.push('```');
    lines.push('');
  }

  lines.push('</handoffs>');
}
