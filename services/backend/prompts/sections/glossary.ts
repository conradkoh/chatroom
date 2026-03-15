/**
 * Glossary Section
 *
 * Provides system-specific definitions of key terms used by agents.
 * Each term can optionally declare a linked skill, shown as "(1 skill available)"
 * so agents know they can run `chatroom skill activate <term>` to get more detail.
 */

import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

interface GlossaryTerm {
  /** The term name (also the skill ID if linkedSkillId is set) */
  term: string;
  /** System-specific definition */
  definition: string;
  /** If set, the name of the skill the agent can activate for this term */
  linkedSkillId?: string;
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: 'backlog',
    definition:
      'The list of work items the team intends to do but has not yet started. ' +
      'In this system, backlog items are tasks stored in `chatroom_tasks` with `origin: "backlog"`. ' +
      'They have optional scoring fields: `complexity` (low/medium/high), `value` (low/medium/high), ' +
      'and `priority` (numeric — higher = more important). ' +
      'Agents interact with backlog items using the `chatroom backlog` CLI command group.',
    linkedSkillId: 'backlog',
  },
];

/**
 * Generate the glossary section for the system prompt.
 * Lists all known terms with definitions and skill availability indicators.
 */
export function getGlossarySection(): PromptSection {
  const lines: string[] = ['# Glossary'];

  for (const entry of GLOSSARY_TERMS) {
    const skillNote = entry.linkedSkillId
      ? ` *(1 skill available — run \`chatroom skill activate ${entry.linkedSkillId}\` for full reference)*`
      : '';
    lines.push('');
    lines.push(`**${entry.term}**${skillNote}`);
    lines.push(entry.definition);
  }

  return createSection('glossary', 'knowledge', lines.join('\n'));
}
