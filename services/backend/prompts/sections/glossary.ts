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
    term: 'backlog',
    definition:
      'The list of work items the team intends to do but has not yet started. ' +
      'Agents use the `chatroom backlog` CLI command group to manage backlog items.',
    linkedSkillId: 'backlog',
  },
  {
    term: 'software-engineering',
    definition:
      'Universal software engineering standards: build from the application core outward, SOLID principles, and naming conventions.',
    linkedSkillId: 'software-engineering',
  },
  {
    term: 'code-review',
    definition:
      'Eight-pillar code review framework: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, and dead code elimination. ' +
      'Covers AI-generated code review with focus on maintainability and tech debt prevention.',
    linkedSkillId: 'code-review',
  },
  {
    term: 'workflow',
    definition:
      'DAG-based structured workflows for planning and executing multi-step tasks, including release management. ' +
      'Agents use the `chatroom workflow` CLI command group to create, specify, execute, and track workflows.',
    linkedSkillId: 'workflow',
  },
  {
    term: 'development-workflow',
    definition:
      'Manages the development and release flow: creating release branches, updating versions, raising PRs, and managing feature branches. ' +
      'Use this skill for coordinating complex release and development processes.',
    linkedSkillId: 'development-workflow',
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
  lines.push('');
  lines.push('## When to Activate Skills');
  lines.push('');
  lines.push('**Proactively activate skills** when your task matches their purpose:');
  lines.push('- **development-workflow**: Use when planning or managing complex release processes, coordinating development branches, or handling version updates.');
  lines.push('- **workflow**: Use when breaking down complex multi-step tasks that require coordination across roles or clear dependency management.');
  lines.push('- **code-review**: Use when reviewing code, evaluating PRs, or assessing code quality.');
  lines.push('- **backlog**: Use when creating or managing work item lists and task priorities.');
  lines.push('');
  lines.push('Don\'t wait for the user to ask — proactively activate the skill that matches the task.');

  return createSection('glossary', 'knowledge', lines.join('\n'));
}
