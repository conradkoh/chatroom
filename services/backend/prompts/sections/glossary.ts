/**
 * Glossary Section
 *
 * Provides system-specific definitions of key terms used by agents.
 * Each term can optionally declare a linked skill, shown with "(1 skill available)"
 * so agents know they can run `chatroom skill activate <term>` to get more detail.
 */

import { SKILLS_REGISTRY } from '../../src/domain/usecase/skills/registry';
import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';
import { getCliEnvPrefix } from '../utils/index';

export interface GlossarySectionParams {
  convexUrl: string;
  chatroomId?: string;
  role?: string;
  nativeIntegration?: boolean;
}

export interface GlossaryTerm {
  /** The term name (also the skill ID if linkedSkillId is set) */
  term: string;
  /** Short, system-specific definition (~2 lines) */
  definition: string;
  /** If set, the ID of the skill the agent can activate for this term */
  linkedSkillId?: string;
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: 'session',
    definition:
      'The entire agent invocation (one harness turn) — from harness startup to shutdown. ' +
      'A session spans many chatroom tasks. Completing a chatroom task (handoff) does NOT end the session. ' +
      'Always run `get-next-task` after a handoff to stay in the session.',
  },
  {
    term: 'chatroom-task',
    definition:
      'One discrete unit of work delivered by `get-next-task`. ' +
      'A chatroom task begins when the agent receives it and ends when the agent runs `handoff`. ' +
      'Completing a chatroom task only closes Level B — the session (Level A) continues.',
  },
  {
    term: 'listen-loop',
    definition:
      'The mandatory foreground loop: after every `handoff`, run `get-next-task` to listen for the next chatroom task. ' +
      'Running `get-next-task` in the background or skipping it breaks the listen loop and disconnects the agent.',
  },
  {
    term: 'backlog',
    definition:
      'The list of work items the team intends to do but has not yet started. ' +
      'Agents use the `chatroom backlog` CLI command group to manage backlog items.',
    linkedSkillId: 'backlog',
  },
  {
    term: 'code-review',
    definition:
      'Eight-pillar code review framework: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, and dead code elimination. ' +
      'Covers AI-generated code review with focus on maintainability and tech debt prevention.',
    linkedSkillId: 'code-review',
  },
  {
    term: 'structural-decisions',
    definition:
      'Meta-level architectural choices that persist in the codebase and influence consistency: ' +
      'folder structure, file naming, interface definitions, and key abstraction names/locations ' +
      '(e.g., Repository/Service layers).',
    // No linkedSkillId - this is a concept, not a standalone skill
  },
];

const NATIVE_GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: 'session',
    definition: 'Your ongoing involvement in this chatroom across multiple tasks.',
  },
  {
    term: 'chatroom-task',
    definition: 'One discrete unit of work. Complete it with `handoff`.',
  },
  ...GLOSSARY_TERMS.filter(
    (entry) =>
      entry.term !== 'session' && entry.term !== 'chatroom-task' && entry.term !== 'listen-loop'
  ),
];

function formatGlossaryEntry(entry: GlossaryTerm): string[] {
  const skillNote = entry.linkedSkillId ? ' (1 skill available)' : '';
  return [`- \`${entry.term}\`${skillNote}`, `    - ${entry.definition}`, ''];
}

function buildSkillsSection(cliEnvPrefix: string): string[] {
  const lines = ['# Skills', ''];
  lines.push(
    `Run \`${cliEnvPrefix}chatroom skill list --chatroom-id=<id> --role=<role>\` to list all available skills.`
  );
  lines.push('');
  lines.push('## When to Activate Skills');
  lines.push('');
  lines.push('**Proactively activate skills** when your task matches their purpose:');
  for (const skill of SKILLS_REGISTRY) {
    lines.push(`- **${skill.skillId}**: ${skill.description}`);
  }
  lines.push('');
  lines.push(
    "Don't wait for the user to ask — proactively activate the skill that matches the task."
  );
  return lines;
}

/**
 * Generate the glossary section for the system prompt.
 * Lists all known terms with definitions and skill availability indicators,
 * followed by a Skills discovery line.
 */
export function getGlossarySection(params: GlossarySectionParams): PromptSection {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const lines: string[] = ['# Glossary', ''];
  const terms = params.nativeIntegration ? NATIVE_GLOSSARY_TERMS : GLOSSARY_TERMS;

  for (const entry of terms) {
    lines.push(...formatGlossaryEntry(entry));
  }

  lines.push(...buildSkillsSection(cliEnvPrefix));

  return createSection('glossary', 'knowledge', lines.join('\n'));
}
