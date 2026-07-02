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
import { appendTaskDeliveryContextSection } from '../task-delivery/context-staleness.js';
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

  lines.push('', '<task-intake>', taskIntakeContent, '</task-intake>');
}

function appendNativeAttachedMessages(
  lines: string[],
  attachedMessages: { content: string; senderRole: string }[]
): void {
  for (const attached of attachedMessages) {
    lines.push('', '<attached>', `From: ${attached.senderRole}`, attached.content, '</attached>');
  }
}

function appendNativeTaskSection(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'task'
    | 'message'
    | 'attachedMessages'
    | 'isEntryPoint'
    | 'sourceAttachments'
    | 'currentContext'
    | 'originMessage'
    | 'followUpCountSinceOrigin'
    | 'originMessageCreatedAt'
  >
): void {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    task,
    message,
    attachedMessages = [],
    isEntryPoint,
    sourceAttachments,
    currentContext = null,
    originMessage = null,
    followUpCountSinceOrigin = 0,
    originMessageCreatedAt = null,
  } = params;

  lines.push('<task>', `Task ID: ${task._id}`);
  if (message) lines.push(`From: ${message.senderRole}`);
  appendTaskDeliveryContextSection(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    isEntryPoint: isEntryPoint ?? false,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  });
  lines.push('', task.content);
  lines.push(
    ...renderDeliveryAttachmentsBlock(sourceAttachments ?? {}, { chatroomId, role, mode: 'native' })
  );
  appendNativeAttachedMessages(lines, attachedMessages);
  lines.push('</task>');
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
    attachedMessages,
    isEntryPoint,
    sourceAttachments,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  } = params;

  const lines: string[] = [];
  appendNativeTaskSection(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    task,
    message,
    attachedMessages,
    isEntryPoint,
    sourceAttachments,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  });
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
