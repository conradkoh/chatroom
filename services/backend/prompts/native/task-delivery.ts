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
import {
  appendTaskDeliveryHandoffTargets,
  appendTaskDeliveryHandoffTemplates,
  appendTaskDeliveryNextSteps,
  type TaskDeliveryParams,
} from '../task-delivery/core.js';
import { renderTaskEnvelopeLines } from '../task-delivery/render-task-envelope.js';

export type NativeTaskDeliveryParams = TaskDeliveryParams;

function appendNativeTaskIntake(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'teamId' | 'isEntryPoint' | 'message'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, isEntryPoint, message } = params;

  const taskIntakeContent = isEntryPoint
    ? getNativeTaskStartedPrompt({
        chatroomId,
        role,
        cliEnvPrefix,
        triggerMessageId: message?._id,
      })
    : getNativeTaskStartedPromptForHandoffRecipient();

  lines.push('', '<task-intake>', taskIntakeContent, '</task-intake>');
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
    | 'isEntryPoint'
    | 'sourceAttachments'
    | 'currentContext'
    | 'originMessage'
    | 'followUpCountSinceOrigin'
    | 'originMessageCreatedAt'
  >
): void {
  lines.push(
    ...renderTaskEnvelopeLines({
      ...params,
      deliveryMode: 'native',
      isEntryPoint: params.isEntryPoint ?? false,
    })
  );
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
    isEntryPoint,
    sourceAttachments,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  });
  appendNativeTaskIntake(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    isEntryPoint,
    message,
  });
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
