// fallow-ignore-file unused-file
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
 *
 * Temporary: S4a ships the renderers ahead of the prompt wiring, so the
 * dead-code suppression above is needed until S4b consumes them.
 */

import { neutralizeChatroomBlockTags } from '@workspace/shared/domain/custom-agent';

import {
  defaultInboundHandoffTemplate,
  defaultReturnHandoffTemplate,
} from './default-handoff-templates';
import type { CustomDelegate, CustomRoleInstructions } from './types';
import { formatHandoffPairLabel } from '../cli/handoff-templates/pair';
import { createSection, type PromptSection } from '../types/sections';

const INSTRUCTIONS_OPEN = '<custom-agent-instructions>';
const INSTRUCTIONS_CLOSE = '</custom-agent-instructions>';
const ROSTER_OPEN = '<team-roster>';
const ROSTER_CLOSE = '</team-roster>';

/** The role's own instructions, wrapped so the agent sees them as one block. */
export function getCustomAgentInstructionsSection(self: CustomRoleInstructions): PromptSection {
  const body = neutralizeChatroomBlockTags(self.systemPrompt).trim();
  return createSection(
    'custom-agent-instructions',
    'guidance',
    [INSTRUCTIONS_OPEN, body, INSTRUCTIONS_CLOSE].join('\n')
  );
}

/** How this role returns work to the entry point: authored template or generated default. */
export function getCustomAgentReturnHandoffSection(
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
 * An entry point with no delegates has nothing to say, so the returned section
 * has empty content. `composeSections` drops empty sections, which is the
 * existing machinery's "no section" representation; callers can also filter on
 * `content.trim()`.
 */
export function getCustomAgentRosterSection(
  entryPoint: string,
  delegates: readonly CustomDelegate[]
): PromptSection {
  if (delegates.length === 0) return createSection('custom-agent-roster', 'knowledge', '');

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
