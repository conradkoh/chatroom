/**
 * Glossary Section
 *
 * Provides system-specific definitions of key terms used by agents.
 * Each term can optionally declare a linked skill, shown with "(1 skill available)"
 * so agents know they can run `chatroom skill activate <term>` to get more detail.
 */

import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

export interface GlossarySectionParams {
  convexUrl: string;
  chatroomId?: string;
  role?: string;
}

interface GlossaryTerm {
  /** The term name (also the skill ID if linkedSkillId is set) */
  term: string;
  /** Short, system-specific definition (~2 lines) */
  definition: string;
  /** If set, the ID of the skill the agent can activate for this term */
  linkedSkillId?: string;
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: 'backlog',
    definition:
      'The list of work items the team intends to do but has not yet started. ' +
      'Agents use the `chatroom backlog` CLI command group to manage backlog items.',
    linkedSkillId: 'backlog',
  },
];

/**
 * Generate the glossary section for the system prompt.
 * Lists all known terms with definitions and skill availability indicators,
 * followed by a Skills discovery line.
 */
export function getGlossarySection(params: GlossarySectionParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const lines: string[] = ['# Glossary', ''];

  for (const entry of GLOSSARY_TERMS) {
    const skillNote = entry.linkedSkillId ? ' (1 skill available)' : '';
    lines.push(`- \`${entry.term}\`${skillNote}`);
    lines.push(`    - ${entry.definition}`);
    lines.push('');
  }

  lines.push('# Skills', '');
  lines.push(
    `Run \`${cliEnvPrefix}chatroom skill list --chatroom-id=<id> --role=<role>\` to list all available skills.`
  );

  return createSection('glossary', 'knowledge', lines.join('\n'));
}
