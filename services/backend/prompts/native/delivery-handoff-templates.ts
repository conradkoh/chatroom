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
import { buildCustomAgentSections } from '../custom-agents/render-custom-agent-sections';
import type { CustomAgentPromptContext } from '../custom-agents/types';

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
function formatDeliveredHandoffTemplateHeading(pair: HandoffTemplatePair): string {
  return `### Handoff template ${formatHandoffPairLabel(pair)}`;
}

/**
 * The custom pair that applies when this delivery hands off to `toRole`, as a
 * `from → to` label, or `null` when the pair is not a custom one.
 *
 * A custom role delivers back to the entry point; the entry point delivers to
 * each of its custom delegates. Builtin catalogs are untouched: the caller only
 * consults this when the builtin lookup missed.
 */
export function getCustomDeliveredHandoffPairLabel(
  customAgents: CustomAgentPromptContext | undefined,
  toRole: string
): string | null {
  if (customAgents === undefined) return null;
  return customAgents.self === undefined
    ? delegatePairLabel(customAgents, toRole)
    : selfPairLabel(customAgents, toRole);
}

function selfPairLabel(context: CustomAgentPromptContext, toRole: string): string | null {
  if (context.self === undefined) return null;
  return matchesRole(context.entryPoint, toRole)
    ? formatHandoffPairLabel({ fromRole: context.self.name, toRole: context.entryPoint })
    : null;
}

function delegatePairLabel(context: CustomAgentPromptContext, toRole: string): string | null {
  const delegate = context.delegates.find((candidate) => matchesRole(candidate.name, toRole));
  return delegate === undefined
    ? null
    : formatHandoffPairLabel({ fromRole: context.entryPoint, toRole: delegate.name });
}

function matchesRole(candidate: string, role: string): boolean {
  return candidate.trim().toLowerCase() === role.trim().toLowerCase();
}

/**
 * Custom handoff blocks for the delivery list: the role's return template, or
 * the entry point's roster with the inbound template per delegate. Both come
 * from the S4b1 splitter, so headings and neutralization match the role prompt.
 */
function customHandoffBlocks(customAgents: CustomAgentPromptContext | undefined): string[] {
  if (customAgents === undefined) return [];
  return buildCustomAgentSections(customAgents).afterRoleGuidance.map((section) => section.content);
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
    customAgents?: CustomAgentPromptContext | undefined;
  }
): void {
  const pairs = listHandoffTemplatePairs(params.teamId, params.role);
  const blocks = [
    ...pairs.flatMap(
      (pair) =>
        renderNativeDeliveryTemplateBlock(
          {
            chatroomId: params.chatroomId,
            cliEnvPrefix: params.cliEnvPrefix,
            conversationMode: params.conversationMode,
          },
          pair
        ) ?? []
    ),
    ...customHandoffBlocks(params.customAgents),
  ];
  if (blocks.length === 0) return;

  lines.push('');
  lines.push('<handoff-templates>');
  lines.push('Use these structures when handing off.');
  lines.push('');
  lines.push(...blocks);
  lines.push('</handoff-templates>');
}
