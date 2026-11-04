/**
 * Prompt sections for user-authored custom agent roles.
 *
 * Three sections are built here and nowhere else:
 * - `custom-agent-instructions`: the role's own system prompt.
 * - `custom-agent-return-handoff`: how the role hands work back to the entry point.
 * - `custom-agent-roster`: the entry point's view of every delegate plus the
 *   inbound handoff template for each.
 *
 * Authored text is untrusted. Every string that came from a file on disk
 * (`systemPrompt`, `returnHandoffTemplate`, `inboundHandoffTemplate`,
 * `description`) passes through `neutralizeChatroomBlockTags` before rendering,
 * so it cannot impersonate protocol markup. Generated defaults are already clean
 * and are rendered as-is; `default-handoff-templates.test.ts` proves that.
 *
 * These sections are pure: no database, no clock, no environment.
 */

import { neutralizeChatroomBlockTags } from '@workspace/shared/domain/custom-agent';

import {
  defaultInboundHandoffTemplate,
  defaultReturnHandoffTemplate,
} from './default-handoff-templates';
import type { CustomAgentPromptContext, CustomDelegate, CustomRoleInstructions } from './types';
import { formatHandoffPairLabel } from '../cli/handoff-templates/pair';
import { createSection, type PromptSection } from '../types/sections';

/**
 * Sections a custom-agent context contributes, split by where they belong in a
 * prompt. Every path that renders a role uses both buckets in the same order:
 * instructions right after the role description, return handoff and roster
 * right after the role guidance. A builtin context (`undefined`) contributes
 * nothing, which is what keeps builtin prompts byte-identical.
 */
export interface CustomAgentSections {
  afterRoleDescription: PromptSection[];
  afterRoleGuidance: PromptSection[];
}

export function buildCustomAgentSections(
  context: CustomAgentPromptContext | undefined
): CustomAgentSections {
  if (context === undefined) return { afterRoleDescription: [], afterRoleGuidance: [] };
  return {
    afterRoleDescription: selfSections(context),
    afterRoleGuidance: guidanceSections(context),
  };
}

function selfSections(context: CustomAgentPromptContext): PromptSection[] {
  return context.self === undefined ? [] : [getCustomAgentInstructionsSection(context.self)];
}

function guidanceSections(context: CustomAgentPromptContext): PromptSection[] {
  const sections: PromptSection[] = [];
  if (context.self !== undefined) {
    sections.push(getCustomAgentReturnHandoffSection(context.self, context.entryPoint));
  }
  if (context.delegates.length > 0) {
    sections.push(getCustomAgentRosterSection(context.entryPoint, context.delegates));
  }
  return sections;
}

const INSTRUCTIONS_OPEN = '<custom-agent-instructions>';
const INSTRUCTIONS_CLOSE = '</custom-agent-instructions>';
const ROSTER_OPEN = '<team-roster>';
const ROSTER_CLOSE = '</team-roster>';

/** The role's own instructions, wrapped so the agent sees them as one block. */
function getCustomAgentInstructionsSection(self: CustomRoleInstructions): PromptSection {
  const body = neutralizeChatroomBlockTags(self.systemPrompt).trim();
  return createSection(
    'custom-agent-instructions',
    'guidance',
    [INSTRUCTIONS_OPEN, body, INSTRUCTIONS_CLOSE].join('\n')
  );
}

/** How this role returns work to the entry point: authored template or generated default. */
function getCustomAgentReturnHandoffSection(
  self: CustomRoleInstructions,
  entryPoint: string
): PromptSection {
  const template =
    self.returnHandoffTemplate === null
      ? defaultReturnHandoffTemplate(self.name, entryPoint)
      : neutralizeChatroomBlockTags(self.returnHandoffTemplate);
  return createSection(
    'custom-agent-return-handoff',
    'guidance',
    handoffBlock(self.name, entryPoint, template)
  );
}

/**
 * The entry point's delegate roster and inbound templates.
 *
 * Only called with at least one delegate: `guidanceSections` skips the section
 * entirely when there is nothing to list, so an empty roster never reaches
 * `composeSections`.
 */
function getCustomAgentRosterSection(
  entryPoint: string,
  delegates: readonly CustomDelegate[]
): PromptSection {
  const lines = [
    ROSTER_OPEN,
    ...delegates.map(
      (delegate) => `- ${delegate.name} — ${neutralizeChatroomBlockTags(delegate.description)}`
    ),
    ROSTER_CLOSE,
    '',
    ...delegates.flatMap((delegate) => [delegateBlock(entryPoint, delegate), '']),
  ];
  return createSection('custom-agent-roster', 'knowledge', lines.join('\n').trim());
}

function delegateBlock(entryPoint: string, delegate: CustomDelegate): string {
  const template =
    delegate.inboundHandoffTemplate === null
      ? defaultInboundHandoffTemplate(delegate.name)
      : neutralizeChatroomBlockTags(delegate.inboundHandoffTemplate);
  return handoffBlock(entryPoint, delegate.name, template);
}

/** `### Handoff template `from` → `to`` followed by the body, matching builtin blocks. */
function handoffBlock(fromRole: string, toRole: string, template: string): string {
  const heading = `### Handoff template ${formatHandoffPairLabel({ fromRole, toRole })}`;
  return [heading, '', template.trim()].join('\n');
}
