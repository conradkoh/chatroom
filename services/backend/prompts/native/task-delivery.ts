/**
 * Slim task delivery output for native-integration harnesses.
 *
 * Focus: task content + available handoff commands. No listen-loop,
 * injection, or session-lifecycle framing — the system delivers work;
 * the agent completes it and hands off.
 */

import { appendNativeDeliveryHandoffTemplates } from './delivery-handoff-templates';
import { handoffCommand } from '../cli/handoff/command';

export interface NativeTaskDeliveryParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  teamId?: string;
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  availableHandoffTargets: string[];
  attachedMessages?: { _id: string; content: string; senderRole: string }[];
}

function appendHandoffTargets(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'availableHandoffTargets'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, availableHandoffTargets } = params;
  if (availableHandoffTargets.length === 0) return;

  lines.push('');
  lines.push('<handoffs>');
  lines.push('When complete, hand off using one of:');
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

/** Task body plus handoff commands for each available target role. */
export function generateNativeTaskDeliveryOutput(params: NativeTaskDeliveryParams): string {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    attachedMessages = [],
  } = params;

  const lines: string[] = [`<task>`, `Task ID: ${task._id}`];
  if (message) lines.push(`From: ${message.senderRole}`);
  lines.push('', task.content);

  for (const attached of attachedMessages) {
    lines.push('', '<attached>', `From: ${attached.senderRole}`, attached.content, '</attached>');
  }

  lines.push('</task>');
  appendNativeDeliveryHandoffTemplates(lines, { teamId, role });
  appendHandoffTargets(lines, { chatroomId, role, cliEnvPrefix, availableHandoffTargets });

  return lines.join('\n').trim();
}
