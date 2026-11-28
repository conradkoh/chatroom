import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { renderAgenticQueryEnvelope } from './agentic-query/render-task-envelope';
import { renderAgenticQuerySystemPrompt } from './agentic-query/system-prompt';
import { generateAgentPrompt } from './base/webapp/init/generator';
import { getGroundingRules, getGroundingSkeleton } from './cli/grounding/grounding-template';
import { listHandoffTemplatePairs, renderHandoffTemplate } from './cli/handoff-templates';
import { getDesignPolicy } from './policies/design';
import { getPerformancePolicy } from './policies/performance';
import { getSecurityPolicy } from './policies/security';
import { getReviewGuidelines } from './review-guidelines';
import {
  CHARACTERISATION_CHATROOM_ID,
  CHARACTERISATION_CONVEX_URL,
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
  'ShadCN',
  'Base UI',
  'lucide',
  'react-icons',
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
  /** The exact rendered snippet that contains the one allowed occurrence and the framing that makes it acceptable. */
  snippet: string;
  reason: string;
}

/**
 * The only allowed project-specific mentions. Each entry accounts for exactly
 * one rendered occurrence and names the snippet that frames it: an example for
 * the reader's project, or the chatroom platform's own infrastructure.
 */
const ALLOWED_OCCURRENCES: readonly AllowedOccurrence[] = [
  {
    source: 'policies/design.ts',
    token: 'docs/',
    snippet: '- `docs/design/*.md` - Design documentation',
    reason:
      "`### Codebase-Specific Design` frames the list as example locations in the reader's project and closes with `Always verify against your project's specific design system.`",
  },
  {
    source: 'policies/design.ts',
    token: 'AGENTS',
    snippet: '- `AGENTS.md` or `CLAUDE.md` - May contain UI guidelines',
    reason:
      'Same framed example list; AGENTS.md is named as an example location for UI guidelines.',
  },
  {
    source: 'policies/design.ts',
    token: 'CLAUDE',
    snippet: '- `AGENTS.md` or `CLAUDE.md` - May contain UI guidelines',
    reason:
      'Same framed example list; CLAUDE.md is named as an example location for UI guidelines.',
  },
  {
    source: 'policies/security.ts',
    token: 'docs/',
    snippet: '- Security documentation in `docs/security*.md`',
    reason:
      "A path example for the reader's project documentation under `### Codebase-Specific Security`, which asks the reader to check those locations.",
  },
  {
    source: 'policies/performance.ts',
    token: 'Convex',
    snippet: '**If your project uses Convex:**',
    reason:
      '`### Platform-Specific Considerations` introduces each stack as an example under `If your project uses ...`.',
  },
  {
    source: 'policies/performance.ts',
    token: 'Next.js',
    snippet: '**If your project uses Next.js:**',
    reason:
      '`### Platform-Specific Considerations` introduces each stack as an example under `If your project uses ...`.',
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'AGENTS',
    snippet: '- `AGENTS.md` - Generic agent guidelines',
    reason:
      'GUIDELINE_FILE_LOCATIONS lists cross-tool filenames and tells the reviewer to adapt them to the files that exist in THIS codebase.',
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'CLAUDE',
    snippet: '- `CLAUDE.md` - Claude-specific instructions',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists cross-tool filenames, framed for the reader's codebase.",
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'CONTRIBUTING',
    snippet: '- `CONTRIBUTING.md` - Contribution guidelines',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists cross-tool filenames, framed for the reader's codebase.",
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'docs/',
    snippet: '- `docs/design/*.md` - Design guidelines',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists example documentation locations, framed for the reader's codebase.",
  },
  {
    source: 'review-guidelines/review.ts',
    token: 'docs/',
    snippet: '- `docs/style-guide.md` - Style guides',
    reason:
      "GUIDELINE_FILE_LOCATIONS lists example documentation locations, framed for the reader's codebase.",
  },
  {
    source: 'agentic-query system prompt',
    token: 'Convex',
    snippet: 'Convex URL:',
    reason:
      "Names the chatroom platform's own backend URL that the query completes against; it is infrastructure, not a stack recommendation for the reader's project.",
  },
];

const CUSTOM_TEAM: CharacterisationTeam = {
  teamId: 'custom',
  teamName: 'Custom Team',
  teamRoles: ['tester', 'architect', 'builder', 'specifier'],
};

const PRESET_TEAM_IDS = ['duo', 'solo', 'trio'] as const;

const TEAMS: readonly CharacterisationTeam[] = [
  { teamId: 'duo', teamName: TEAM_PRESETS.duo.name, teamRoles: [...TEAM_PRESETS.duo.roles] },
  { teamId: 'solo', teamName: TEAM_PRESETS.solo.name, teamRoles: [...TEAM_PRESETS.solo.roles] },
  { teamId: 'trio', teamName: TEAM_PRESETS.trio.name, teamRoles: [...TEAM_PRESETS.trio.roles] },
  CUSTOM_TEAM,
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
    { source: 'review-guidelines/review.ts', text: getReviewGuidelines() },
    { source: 'cli/grounding skeleton', text: getGroundingSkeleton() },
    { source: 'cli/grounding rules', text: getGroundingRules() },
    {
      source: 'agentic-query system prompt',
      text: renderAgenticQuerySystemPrompt({
        chatroomId: CHARACTERISATION_CHATROOM_ID,
        queryId: 'characterisation-query',
        convexUrl: CHARACTERISATION_CONVEX_URL,
      }),
    },
    {
      source: 'agentic-query task envelope',
      text: renderAgenticQueryEnvelope({
        queryId: 'characterisation-query',
        chatroomId: CHARACTERISATION_CHATROOM_ID,
        mode: 'ask',
        workspace: {
          machineId: 'characterisation-machine',
          workingDir: '/characterisation',
          hostname: 'characterisation-host',
        },
        userMessage: 'characterisation request',
        cliCompleteCommand: `chatroom agentic-query complete --chatroom-id=${CHARACTERISATION_CHATROOM_ID} --query-id=characterisation-query`,
      }),
    },
    {
      source: 'base/webapp custom agent prompt',
      text: generateAgentPrompt({
        chatroomId: CHARACTERISATION_CHATROOM_ID,
        role: 'builder',
        teamName: CUSTOM_TEAM.teamName,
        teamRoles: [...CUSTOM_TEAM.teamRoles],
        convexUrl: CHARACTERISATION_CONVEX_URL,
      }),
    }
  );

  return prompts;
}

function occurrenceIndices(text: string, needle: string): number[] {
  const indices: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    indices.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return indices;
}

function allowedCount(source: string, token: ProjectSpecificToken): number {
  return ALLOWED_OCCURRENCES.filter(
    (occurrence) => occurrence.source === source && occurrence.token === token
  ).length;
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
        const indices = occurrenceIndices(text, token);
        const allowed = allowedCount(source, token);
        if (indices.length === allowed) continue;

        if (indices.length > allowed) {
          for (const index of indices.slice(allowed)) {
            violations.push(
              `${source} renders "${token}" ${indices.length} time(s) but only ${allowed} framed occurrence(s) are allowed near: ${snippetAt(text, index)}`
            );
          }
        } else {
          violations.push(
            `${source} renders "${token}" ${indices.length} time(s) but the allowlist expects ${allowed} framed occurrence(s)`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('every allowlisted occurrence is framed by its documented snippet exactly once', () => {
    const prompts = renderedPrompts();
    const keys = ALLOWED_OCCURRENCES.map(
      (occurrence) => `${occurrence.source}\u0000${occurrence.token}\u0000${occurrence.snippet}`
    );
    expect(new Set(keys).size, 'allowlist snippets must be unique per source and token').toBe(
      keys.length
    );

    for (const occurrence of ALLOWED_OCCURRENCES) {
      const entry = prompts.find((prompt) => prompt.source === occurrence.source);
      if (!entry) {
        throw new Error(`allowlist names a source that is not rendered: ${occurrence.source}`);
      }

      const label = `${occurrence.source} "${occurrence.token}" (${occurrence.snippet})`;
      expect(
        occurrenceIndices(occurrence.snippet, occurrence.token),
        `allowlist snippet must contain "${occurrence.token}" exactly once: ${label}`
      ).toHaveLength(1);
      expect(
        occurrenceIndices(entry.text, occurrence.snippet),
        `stale or ambiguous allowlist entry; snippet must occur exactly once: ${label} — ${occurrence.reason}`
      ).toHaveLength(1);
    }
  });
});
