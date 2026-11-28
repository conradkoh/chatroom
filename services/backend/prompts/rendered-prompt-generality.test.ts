import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { listHandoffTemplatePairs, renderHandoffTemplate } from './cli/handoff-templates';
import { getDesignPolicy } from './policies/design';
import { getPerformancePolicy } from './policies/performance';
import { getSecurityPolicy } from './policies/security';
import { getReviewGuidelines } from './review-guidelines';
import {
  renderInitSystemPrompt,
  renderRolePrompt,
  rolesUnderCharacterisation,
  type CharacterisationTeam,
} from './teams/role-prompt-characterisation';

/**
 * Tokens that name one project's stack or repository layout. Matched
 * case-sensitively on purpose: rendered commands legitimately carry the
 * infrastructure env var `CHATROOM_CONVEX_URL`, which is not a stack claim.
 */
const PROJECT_SPECIFIC_TOKENS = [
  'Convex',
  'Next.js',
  'Tailwind',
  'memory/',
  'docs/',
  'apps/',
  'services/',
  'packages/',
  'pnpm',
  '@workspace',
  'AGENTS',
  'CLAUDE',
  'CONTRIBUTING',
] as const;

type ProjectSpecificToken = (typeof PROJECT_SPECIFIC_TOKENS)[number];

interface RenderedPrompt {
  source: string;
  text: string;
}

interface AllowedOccurrence {
  source: string;
  token: ProjectSpecificToken;
  reason: string;
}

/**
 * The only allowed project-specific mentions. Each is an accepted exception
 * group whose text frames the value as an example for the reader's project.
 */
const ALLOWED_OCCURRENCES: readonly AllowedOccurrence[] = [
  {
    source: 'policies/design.ts',
    token: 'docs/',
    reason:
      "`### Codebase-Specific Design` frames the list as example locations in the reader's project and closes with `Always verify against your project's specific design system.`",
  },
  {
    source: 'policies/design.ts',
    token: 'AGENTS',
    reason:
      'Same framed example list; AGENTS.md is named as an example location for UI guidelines.',
  },
  {
    source: 'policies/design.ts',
    token: 'CLAUDE',
    reason:
      'Same framed example list; CLAUDE.md is named as an example location for UI guidelines.',
  },
  {
    source: 'policies/security.ts',
    token: 'docs/',
    reason: "A path example for the reader's project documentation (`docs/security*.md`).",
  },
  {
    source: 'policies/performance.ts',
    token: 'Convex',
    reason:
      '`### Platform-Specific Considerations` introduces each stack as an example under `If your project uses ...`.',
  },
  {
    source: 'policies/performance.ts',
    token: 'Next.js',
    reason:
      '`### Platform-Specific Considerations` introduces each stack as an example under `If your project uses ...`.',
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'AGENTS',
    reason:
      'GUIDELINE_FILE_LOCATIONS lists cross-tool filenames and tells the reviewer to adapt them to the files that exist in THIS codebase.',
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'CLAUDE',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists cross-tool filenames, framed for the reader's codebase.",
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'CONTRIBUTING',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists cross-tool filenames, framed for the reader's codebase.",
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'docs/',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists example documentation locations, framed for the reader's codebase.",
  },
];

const PRESET_TEAM_IDS = ['duo', 'solo', 'trio'] as const;

const TEAMS: readonly CharacterisationTeam[] = [
  { teamId: 'duo', teamName: TEAM_PRESETS.duo.name, teamRoles: [...TEAM_PRESETS.duo.roles] },
  { teamId: 'solo', teamName: TEAM_PRESETS.solo.name, teamRoles: [...TEAM_PRESETS.solo.roles] },
  { teamId: 'trio', teamName: TEAM_PRESETS.trio.name, teamRoles: [...TEAM_PRESETS.trio.roles] },
  {
    teamId: 'custom',
    teamName: 'Custom Team',
    teamRoles: ['tester', 'architect', 'builder', 'specifier'],
  },
];

function renderedPrompts(): RenderedPrompt[] {
  const prompts: RenderedPrompt[] = [];

  for (const team of TEAMS) {
    for (const role of rolesUnderCharacterisation(team)) {
      prompts.push({
        source: `${team.teamId}/${role} role guidance`,
        text: renderRolePrompt(team, role),
      });
      prompts.push({
        source: `${team.teamId}/${role} init prompt (cli)`,
        text: renderInitSystemPrompt(team, role),
      });
      prompts.push({
        source: `${team.teamId}/${role} init prompt (native)`,
        text: renderInitSystemPrompt(team, role, 'claude-sdk'),
      });
    }
  }

  for (const teamId of PRESET_TEAM_IDS) {
    for (const pair of listHandoffTemplatePairs(teamId)) {
      const text = renderHandoffTemplate(pair);
      if (text === null) continue;
      prompts.push({
        source: `${pair.teamId} ${pair.fromRole} → ${pair.toRole} handoff template`,
        text,
      });
    }
  }

  prompts.push(
    { source: 'policies/design.ts', text: getDesignPolicy() },
    { source: 'policies/performance.ts', text: getPerformancePolicy() },
    { source: 'policies/security.ts', text: getSecurityPolicy() },
    { source: 'review-guidelines/review.ts', text: getReviewGuidelines() }
  );

  return prompts;
}

function isAllowed(source: string, token: ProjectSpecificToken): boolean {
  return ALLOWED_OCCURRENCES.some(
    (occurrence) => occurrence.source === source && occurrence.token === token
  );
}

function snippetAt(text: string, index: number): string {
  return text
    .slice(Math.max(0, index - 40), index + 80)
    .replace(/\s+/g, ' ')
    .trim();
}

describe('rendered prompt generality', () => {
  test('rendered prompts name no project-specific stack or structure', () => {
    const violations: string[] = [];

    for (const { source, text } of renderedPrompts()) {
      for (const token of PROJECT_SPECIFIC_TOKENS) {
        const index = text.indexOf(token);
        if (index === -1 || isAllowed(source, token)) continue;
        violations.push(`${source} renders "${token}" near: ${snippetAt(text, index)}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test('every allowlisted exception still occurs in its documented source', () => {
    const prompts = renderedPrompts();

    for (const occurrence of ALLOWED_OCCURRENCES) {
      const entry = prompts.find((prompt) => prompt.source === occurrence.source);
      if (!entry) {
        throw new Error(`allowlist names a source that is not rendered: ${occurrence.source}`);
      }
      expect(
        entry.text,
        `stale allowlist entry for ${occurrence.source}: ${occurrence.token} (${occurrence.reason})`
      ).toContain(occurrence.token);
    }
  });
});
