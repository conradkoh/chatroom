/**
 * Shared task delivery sections: next steps, handoff templates, handoff targets.
 *
 * Used by both native and CLI task delivery paths.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { isSupportedEnhancerRole } from '@workspace/shared/domain/enhancer-team-capability';

import {
  appendPlanningReviewOutcomeGuidance,
  appendTaskDeliveryEnhancerGuidance,
  appendTaskDeliveryEnhancerDisabledGuidance,
  appendTaskDeliveryEnhancerInputGuidance,
  isPlanningReviewOutcomeContent,
} from './enhancer-guidance.js';
import { appendEnhancerRoleTaskDeliveryGuidance } from './enhancer-role-guidance';
import type { PrimaryDeliveryAttachments } from '../../src/domain/entities/message-attachments.js';
import { inferPrimaryHandoffTarget } from '../../src/domain/handoff/infer-primary-handoff-target';
import { handoffCommand } from '../cli/handoff/command';
import { appendNativeDeliveryHandoffTemplates as appendTaskDeliveryHandoffTemplates } from '../native/delivery-handoff-templates.js';

export interface TaskDeliveryParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  teamId?: string | undefined;
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  availableHandoffTargets: string[];
  isEntryPoint?: boolean | undefined;
  sourceAttachments?: PrimaryDeliveryAttachments | undefined;
  standingInstructions?: string | null | undefined;
  /** When true, entry-point task delivery includes handoff-enhancer guidance. */
  plannerEnhancerEnabled?: boolean | undefined;
  originUserMessageId?: string | undefined;
  entryPointRole?: string | undefined;
  /**
   * Explicit conversation mode snapshot. When present, drives mode-specific
   * prompt behaviour (e.g. Chat mode suppresses enhancer ceremony).
   */
  conversationMode?: ConversationMode | undefined;
}

/**
 * Returns true when this is a Chat-mode entry-point task from a user message.
 * Chat mode: answer the user directly; no enhancer/delegation ceremony.
 */
function isChatMode(
  params: Pick<TaskDeliveryParams, 'conversationMode' | 'isEntryPoint' | 'message'>
): boolean {
  return (
    params.conversationMode === 'chat' &&
    params.isEntryPoint === true &&
    params.message?.senderRole.toLowerCase() === 'user'
  );
}

function appendPlannerEnhancerGuidanceForMessage(
  lines: string[],
  message: { senderRole: string; content?: string | undefined } | null | undefined,
  ctx: Pick<TaskDeliveryParams, 'chatroomId' | 'role' | 'cliEnvPrefix'>,
  taskContent?: string
): void {
  const senderRole = message?.senderRole.toLowerCase();
  if (senderRole === 'enhancer') {
    const body = taskContent ?? message?.content ?? '';
    if (isPlanningReviewOutcomeContent(body)) {
      appendPlanningReviewOutcomeGuidance(lines);
    } else {
      appendTaskDeliveryEnhancerInputGuidance(lines, ctx);
    }
    return;
  }
}

function appendEnabledEnhancerGuidance(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'plannerEnhancerEnabled'
    | 'originUserMessageId'
    | 'teamId'
    | 'entryPointRole'
    | 'message'
    | 'task'
    | 'isEntryPoint'
    | 'teamId'
  >
): void {
  const senderRole = params.message?.senderRole.toLowerCase();
  if (senderRole === 'user') {
    appendTaskDeliveryEnhancerGuidance(lines, {
      entryPointRole: params.role,
      hasBuilder: params.teamId?.toLowerCase() === 'duo',
    });
    return;
  }
  appendPlannerEnhancerGuidanceForMessage(lines, params.message, params, params.task?.content);
}

function appendTaskDeliveryEnhancerGuidanceIfEnabled(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'plannerEnhancerEnabled'
    | 'message'
    | 'task'
    | 'isEntryPoint'
    | 'teamId'
    | 'conversationMode'
  >
): void {
  if (!params.isEntryPoint || !isSupportedEnhancerRole(params.teamId, params.role)) return;
  // Chat mode: no enhancer ceremony for entry-point user tasks.
  if (isChatMode(params)) return;
  if (params.plannerEnhancerEnabled) return appendEnabledEnhancerGuidance(lines, params);

  const senderRole = params.message?.senderRole?.toLowerCase();
  if (senderRole === 'user' || senderRole === 'builder') {
    appendTaskDeliveryEnhancerDisabledGuidance(lines);
  }
}

function appendPrimaryHandoffInstructions(
  lines: string[],
  params: {
    chatroomId: string;
    role: string;
    cliEnvPrefix: string;
    primaryTarget: string;
    senderRole?: string | undefined;
    requestFirstEnhancerHandoff: boolean;
  }
): void {
  const senderNote = params.senderRole ? ` (task from \`${params.senderRole}\`)` : '';
  lines.push(
    params.requestFirstEnhancerHandoff
      ? `2. **Run this handoff command as your final action now** — this forwards the request to \`${params.primaryTarget}\`${senderNote}:`
      : `2. **When complete, you MUST run the handoff command as your final action this turn** — this completes your work and delivers it to \`${params.primaryTarget}\`${senderNote}:`
  );
  lines.push('', '```bash');
  lines.push(
    handoffCommand({
      chatroomId: params.chatroomId,
      role: params.role,
      nextRole: params.primaryTarget,
      cliEnvPrefix: params.cliEnvPrefix,
    })
  );
  lines.push('```', '');
  lines.push(
    'Fill in the message using the matching template in `<handoff-templates>` below. Replace `[Your message here]` with the template content. The closing line must be exactly `CHATROOM_HANDOFF_END` (not `EOF`). **Run handoff as your last tool call, then end your turn immediately — no further tool calls after handoff.**'
  );
}

function isRequestFirstEnhancerHandoff(
  primaryTarget: string | undefined,
  senderRole: string | undefined
): boolean {
  return primaryTarget?.toLowerCase() === 'enhancer' && senderRole?.toLowerCase() === 'user';
}

function getFirstNextStep(requestFirstEnhancerHandoff: boolean): string {
  return requestFirstEnhancerHandoff
    ? '1. **Immediately hand off the user request to the enhancer before planning, researching, or drafting.** Use the stripped-down enhancer template below.'
    : '1. Work on the task above.';
}

function getTaskSenderRole(message: { senderRole: string } | null | undefined): string | undefined {
  return message ? message.senderRole : undefined;
}

function appendTaskDeliveryNextSteps(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'message'
    | 'availableHandoffTargets'
    | 'isEntryPoint'
    | 'plannerEnhancerEnabled'
    | 'originUserMessageId'
    | 'entryPointRole'
    | 'teamId'
    | 'conversationMode'
  >
): void {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    message,
    availableHandoffTargets,
    isEntryPoint,
    plannerEnhancerEnabled,
    teamId,
    conversationMode,
  } = params;
  const senderRole = getTaskSenderRole(message);
  if (role.toLowerCase() === 'enhancer') {
    appendEnhancerRoleTaskDeliveryGuidance(lines, {
      chatroomId,
      role,
      cliEnvPrefix,
      entryPointRole:
        params.entryPointRole ?? (teamId?.toLowerCase() === 'solo' ? 'solo' : 'planner'),
      originUserMessageId: params.originUserMessageId,
    });
    lines.push('', '</next-steps>');
    return;
  }
  const primaryTarget = inferPrimaryHandoffTarget({
    senderRole,
    role,
    availableHandoffTargets,
    isEntryPoint,
    plannerEnhancerEnabled,
    conversationMode,
  });

  lines.push('');
  lines.push('<next-steps>');
  const requestFirstEnhancerHandoff = isRequestFirstEnhancerHandoff(primaryTarget, senderRole);
  lines.push(getFirstNextStep(requestFirstEnhancerHandoff));

  if (primaryTarget) {
    appendPrimaryHandoffInstructions(lines, {
      chatroomId,
      role,
      cliEnvPrefix,
      primaryTarget,
      senderRole,
      requestFirstEnhancerHandoff,
    });
    lines.push('', '</next-steps>');
    return;
  }

  lines.push(
    '2. **When complete, you MUST run a handoff command from `<handoffs>` below as your final action this turn. Run handoff last, then end your turn immediately — no further tool calls after handoff.**',
    '',
    '</next-steps>'
  );
}

function appendTaskDeliveryHandoffTargets(
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

/** Next steps, optional enhancer guidance, templates, and handoff targets. */
export function appendTaskDeliveryHandoffSections(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'teamId'
    | 'task'
    | 'message'
    | 'availableHandoffTargets'
    | 'isEntryPoint'
    | 'plannerEnhancerEnabled'
    | 'originUserMessageId'
    | 'entryPointRole'
    | 'conversationMode'
  >
): void {
  // Chat-mode direct-answer guidance: concise, no enhancer/delegation ceremony.
  if (isChatMode(params)) {
    lines.push('');
    lines.push('<chat-mode>');
    lines.push('## Conversational Mode (Chat)');
    lines.push('');
    lines.push(
      '**Answer the user directly and concisely.** Do not invoke the enhancer, delegate to another agent, or perform code/repository work unless the request itself requires it.'
    );
    lines.push(
      'When your response is ready, run the final handoff command below to deliver it to the user.'
    );
    lines.push('</chat-mode>');
  }

  appendTaskDeliveryNextSteps(lines, params);
  appendTaskDeliveryEnhancerGuidanceIfEnabled(lines, {
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix: params.cliEnvPrefix,
    plannerEnhancerEnabled: params.plannerEnhancerEnabled,
    message: params.message,
    task: params.task,
    isEntryPoint: params.isEntryPoint,
    teamId: params.teamId,
    conversationMode: params.conversationMode,
  });
  appendTaskDeliveryHandoffTemplates(lines, {
    teamId: params.teamId,
    role: params.role,
    chatroomId: params.chatroomId,
    cliEnvPrefix: params.cliEnvPrefix,
    includeEnhancerTemplate:
      // Chat mode: never include enhancer-only template content.
      params.conversationMode !== 'chat' &&
      params.plannerEnhancerEnabled &&
      params.isEntryPoint === true &&
      params.message?.senderRole.toLowerCase() === 'user',
  });
  appendTaskDeliveryHandoffTargets(lines, params);
}
