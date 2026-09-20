/**
 * Shared task-delivery prompt assembly: next steps, handoff templates, and
 * advertised handoff targets for permanent and ephemeral team agents.
 */

import { isRetiredAgentRole } from '@workspace/shared/domain/agent-role';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { isChatModeEntryPointUserTask } from './chat-mode-policy.js';
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
  conversationMode?: ConversationMode | undefined;
}

function appendPrimaryHandoffInstructions(
  lines: string[],
  params: {
    chatroomId: string;
    role: string;
    cliEnvPrefix: string;
    primaryTarget: string;
    senderRole?: string | undefined;
  }
): void {
  const senderNote = params.senderRole ? ` (task from \`${params.senderRole}\`)` : '';
  lines.push(
    `2. **When complete, you MUST run the handoff command as your final action this turn** — this completes your work and delivers it to \`${params.primaryTarget}\`${senderNote}:`
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

function getTaskSenderRole(message: { senderRole: string } | null | undefined): string | undefined {
  const senderRole = message?.senderRole;
  return senderRole && !isRetiredAgentRole(senderRole) ? senderRole : undefined;
}

function appendTaskDeliveryNextSteps(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'message' | 'availableHandoffTargets' | 'isEntryPoint'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, message, availableHandoffTargets, isEntryPoint } = params;
  const senderRole = getTaskSenderRole(message);
  const primaryTarget = inferPrimaryHandoffTarget({
    senderRole,
    role,
    availableHandoffTargets,
    isEntryPoint,
  });

  lines.push('', '<next-steps>', '1. Work on the task above.');

  if (primaryTarget) {
    appendPrimaryHandoffInstructions(lines, {
      chatroomId,
      role,
      cliEnvPrefix,
      primaryTarget,
      senderRole,
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
    lines.push('```', '');
  }

  lines.push('</handoffs>');
}

/** Next steps, generic templates, and advertised handoff targets. */
export function appendTaskDeliveryHandoffSections(
  lines: string[],
  params: Pick<
    TaskDeliveryParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'teamId'
    | 'message'
    | 'availableHandoffTargets'
    | 'isEntryPoint'
    | 'conversationMode'
  >
): void {
  const activeHandoffTargets = params.availableHandoffTargets.filter(
    (target) => !isRetiredAgentRole(target)
  );
  const activeParams = { ...params, availableHandoffTargets: activeHandoffTargets };

  if (
    isChatModeEntryPointUserTask({
      conversationMode: params.conversationMode,
      isEntryPoint: params.isEntryPoint,
      senderRole: params.message?.senderRole,
    })
  ) {
    lines.push('');
    lines.push('<chat-mode>');
    lines.push('## Conversational Mode (Chat)');
    lines.push('');
    lines.push(
      '**Answer the user directly and concisely by default. Chat mode changes the recommended ceremony, not your team capabilities or handoff authority. If the request requires team work, you may hand off to any advertised team target (for example, builder).**'
    );
    lines.push(
      '**Do not run `chatroom context read` or `chatroom context new` for this Chat-mode task.**'
    );
    lines.push(
      'When your response is ready, run the final handoff command below to deliver it to the user.'
    );
    lines.push('</chat-mode>');
  }

  appendTaskDeliveryNextSteps(lines, activeParams);
  appendTaskDeliveryHandoffTemplates(lines, {
    teamId: params.teamId,
    role: params.role,
    chatroomId: params.chatroomId,
    cliEnvPrefix: params.cliEnvPrefix,
    conversationMode: params.conversationMode,
  });
  appendTaskDeliveryHandoffTargets(lines, activeParams);
}
