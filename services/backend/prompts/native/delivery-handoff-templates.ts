/**
 * Handoff templates eagerly inlined on native task delivery.
 *
 * Gives each role the structures it needs before work starts — final user
 * accountability, delegation format, or return handoffs — without CLI
 * listen-loop framing.
 *
 * The role-owned catalogs are the only registry: every inlined block comes
 * from `listHandoffTemplatePairs(teamId, role)` in contract `returnsTo` order,
 * and each heading names the exact sender → recipient pair.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';
import { formatHandoffPairLabel } from '../cli/handoff-templates/pair';

/** The delivered pair whose recipient is `toRole`, or `null` when none exists. */
export function getDeliveredHandoffTemplatePair(
  teamId: string | undefined,
  role: string,
  toRole: string
): HandoffTemplatePair | null {
  const normalizedTo = toRole.trim().toLowerCase();
  return (
    listHandoffTemplatePairs(teamId, role).find((pair) => pair.toRole === normalizedTo) ?? null
  );
}

/** Section heading for one delivered template, e.g. ``### Handoff template `planner` → `builder` ``. */
export function formatDeliveredHandoffTemplateHeading(pair: HandoffTemplatePair): string {
  return `### Handoff template ${formatHandoffPairLabel(pair)}`;
}

function renderNativeDeliveryTemplateBlock(
  params: {
    chatroomId?: string | undefined;
    cliEnvPrefix?: string | undefined;
    conversationMode?: ConversationMode | undefined;
  },
  pair: HandoffTemplatePair
): string[] | null {
  const template = renderHandoffTemplate(pair, {
    nativeIntegration: true,
    chatroomId: params.chatroomId,
    cliEnvPrefix: params.cliEnvPrefix,
    conversationMode: params.conversationMode,
  });
  if (!template) return null;
  return [formatDeliveredHandoffTemplateHeading(pair), template, ''];
}

export function appendNativeDeliveryHandoffTemplates(
  lines: string[],
  params: {
    teamId?: string | undefined;
    role: string;
    chatroomId?: string | undefined;
    cliEnvPrefix?: string | undefined;
    conversationMode?: ConversationMode | undefined;
    isEntryPoint?: boolean | undefined;
    senderRole?: string | undefined;
  }
): void {
  const pairs = listHandoffTemplatePairs(params.teamId, params.role);
  const blocks = pairs.flatMap(
    (pair) =>
      renderNativeDeliveryTemplateBlock(
        {
          chatroomId: params.chatroomId,
          cliEnvPrefix: params.cliEnvPrefix,
          conversationMode: params.conversationMode,
        },
        pair
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
