/**
 * Slim task delivery output for native-integration harnesses.
 *
 * Focus: task content + task intake + next steps + handoff templates + handoff commands.
 * No listen-loop, injection, or session-lifecycle framing — the system
 * delivers work; the agent completes it and hands off.
 */

import { getNativeEnhancerReviewTaskIntake } from './enhancer-review-intake';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from './task-started-content';
import {
  appendTaskDeliveryHandoffSections,
  type TaskDeliveryParams,
} from '../task-delivery/core.js';
import { renderTaskEnvelopeLines } from '../task-delivery/render-task-envelope.js';

export type NativeTaskDeliveryParams = TaskDeliveryParams;

function resolveNativeTaskIntakeContent(
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'isEntryPoint' | 'message'
  >
): string {
  const { chatroomId, role, cliEnvPrefix, isEntryPoint, message } = params;
  if (!isEntryPoint) {
    return getNativeTaskStartedPromptForHandoffRecipient();
  }
  if (message?.senderRole.toLowerCase() === 'enhancer') {
    return getNativeEnhancerReviewTaskIntake();
  }
  return getNativeTaskStartedPrompt({
    chatroomId,
    role,
    cliEnvPrefix,
    triggerMessageId: message?._id,
  });
}

function appendNativeTaskIntake(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'teamId' | 'isEntryPoint' | 'message'
  >
): void {
  lines.push('', '<task-intake>', resolveNativeTaskIntakeContent(params), '</task-intake>');
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
    | 'standingInstructions'
  >
): void {
  lines.push(
    ...renderTaskEnvelopeLines({
      ...params,
      deliveryMode: 'native',
      isEntryPoint: params.isEntryPoint ?? false,
      standingInstructions: params.standingInstructions,
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
    standingInstructions,
    plannerEnhancerEnabled,
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
    standingInstructions,
  });
  appendNativeTaskIntake(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    isEntryPoint,
    message,
  });
  appendTaskDeliveryHandoffSections(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    isEntryPoint,
    plannerEnhancerEnabled,
  });

  return lines.join('\n').trim();
}
