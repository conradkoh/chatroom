/**
 * Slim task delivery output for native-integration harnesses.
 *
 * Focus: task content + task intake + next steps + handoff templates + handoff commands.
 * No listen-loop, injection, or session-lifecycle framing — the system
 * delivers work; the agent completes it and hands off.
 */

import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from './task-started-content';
import { renderDeliveryAttachmentsBlock } from '../attachments/render-delivery-attachments.js';
import {
  appendTaskDeliveryHandoffTargets,
  appendTaskDeliveryHandoffTemplates,
  appendTaskDeliveryNextSteps,
  type TaskDeliveryParams,
} from '../task-delivery/core.js';

export type NativeTaskDeliveryParams = TaskDeliveryParams;

function appendNativeTaskIntake(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'teamId' | 'isEntryPoint'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, isEntryPoint } = params;

  const taskIntakeContent = isEntryPoint
    ? getNativeTaskStartedPrompt({ chatroomId, role, cliEnvPrefix })
    : getNativeTaskStartedPromptForHandoffRecipient();

  lines.push('');
  lines.push('<task-intake>');
  lines.push(taskIntakeContent);
  lines.push('</task-intake>');
}

/** Task body, task intake, next steps, templates, and handoff commands. */
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
    isEntryPoint,
    sourceAttachments,
  } = params;

  const lines: string[] = [`<task>`, `Task ID: ${task._id}`];
  if (message) lines.push(`From: ${message.senderRole}`);
  lines.push('', task.content);
  lines.push(
    ...renderDeliveryAttachmentsBlock(
      { attachedSnippets: sourceAttachments?.attachedSnippets },
      { chatroomId, role, mode: 'native' }
    )
  );

  for (const attached of attachedMessages) {
    lines.push('', '<attached>', `From: ${attached.senderRole}`, attached.content, '</attached>');
  }

  lines.push('</task>');
  appendNativeTaskIntake(lines, { chatroomId, role, cliEnvPrefix, teamId, isEntryPoint });
  appendTaskDeliveryNextSteps(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    message,
    availableHandoffTargets,
    task,
    isEntryPoint,
  });
  appendTaskDeliveryHandoffTemplates(lines, { teamId, role, chatroomId, cliEnvPrefix });
  appendTaskDeliveryHandoffTargets(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    availableHandoffTargets,
  });

  return lines.join('\n').trim();
}
