/**
 * Handoff templates eagerly inlined on native task delivery.
 *
 * Gives each role the structures it needs before work starts — final user
 * accountability, delegation format, or return handoffs — without CLI
 * listen-loop framing.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { getHandoffTemplate } from '../cli/handoff-templates';
import { isChatModeEntryPointUserTask } from '../task-delivery/chat-mode-policy';

/** toRole targets to inline per team:role on native task delivery. */
const NATIVE_DELIVERY_TEMPLATE_TARGETS: Record<string, readonly string[]> = {
  'solo:solo': ['user'],
  'duo:planner': ['user', 'builder'],
  'duo:builder': ['planner'],
};

// fallow-ignore-next-line complexity
function getNativeDeliveryTemplateTargets(
  teamId: string | undefined,
  role: string,
  includeEnhancerTemplate?: boolean,
  modeContext?: {
    conversationMode?: ConversationMode | undefined;
    isEntryPoint?: boolean | undefined;
    senderRole?: string | undefined;
  }
): readonly string[] {
  // Chat-mode entry-point user tasks: only the user template, no builder/enhancer targets.
  if (isChatModeEntryPointUserTask(modeContext ?? {})) {
    return ['user'];
  }
  const key = `${(teamId ?? 'duo').toLowerCase()}:${role.toLowerCase()}`;
  const base = NATIVE_DELIVERY_TEMPLATE_TARGETS[key] ?? [];
  if (!includeEnhancerTemplate) {
    return base;
  }
  return ['enhancer', ...base];
}

function renderNativeDeliveryTemplateBlock(
  params: {
    teamId?: string | undefined;
    role: string;
    chatroomId?: string | undefined;
    cliEnvPrefix?: string | undefined;
    conversationMode?: ConversationMode | undefined;
  },
  toRole: string
): string[] | null {
  const template = getHandoffTemplate({
    teamId: params.teamId,
    fromRole: params.role,
    toRole,
    nativeIntegration: true,
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix: params.cliEnvPrefix,
    conversationMode: params.conversationMode,
  });
  if (!template) return null;
  return [`### Handoff to \`${toRole}\``, template, ''];
}

export function appendNativeDeliveryHandoffTemplates(
  lines: string[],
  params: {
    teamId?: string | undefined;
    role: string;
    chatroomId?: string | undefined;
    cliEnvPrefix?: string | undefined;
    includeEnhancerTemplate?: boolean | undefined;
    conversationMode?: ConversationMode | undefined;
    isEntryPoint?: boolean | undefined;
    senderRole?: string | undefined;
  }
): void {
  const targets = getNativeDeliveryTemplateTargets(
    params.teamId,
    params.role,
    params.includeEnhancerTemplate,
    {
      conversationMode: params.conversationMode,
      isEntryPoint: params.isEntryPoint,
      senderRole: params.senderRole,
    }
  );
  const blocks = targets.flatMap(
    (toRole) =>
      renderNativeDeliveryTemplateBlock(
        {
          teamId: params.teamId,
          role: params.role,
          chatroomId: params.chatroomId,
          cliEnvPrefix: params.cliEnvPrefix,
          conversationMode: params.conversationMode,
        },
        toRole
      ) ?? []
  );
  if (blocks.length === 0) return;

  lines.push('');
  lines.push('<handoff-templates>');
  lines.push('Use these structures when handing off.');
  lines.push('');
  lines.push(...blocks);
  lines.push('</handoff-templates>');
}
