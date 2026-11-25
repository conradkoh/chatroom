/**
 * Repo-wide acceptance test: no rendered prompt names a removed context command.
 *
 * The context write path is gone, so every prompt surface must be free of it for
 * every team preset and every role. This renders the public surfaces — role
 * prompt, both init prompts, the CLI task-delivery footer, and every handoff
 * template — and asserts none carries a removed command or the old context-read
 * wording.
 *
 * Entry-point surfaces (task-started prompts, native task delivery, and the
 * task-delivery core block) are rendered for each preset's entry-point role in
 * both conversation modes.
 *
 * Uses the public render helpers from `role-prompt-characterisation.ts`, which
 * go through `generateRolePrompt` and `composeInitPrompt`.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import {
  renderInitSystemPrompt,
  renderRolePrompt,
  rolesUnderCharacterisation,
  type CharacterisationTeam,
} from './role-prompt-characterisation';
import {
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  type HandoffTemplatePair,
} from '../cli/handoff-templates';
import { getTaskStartedPrompt } from '../cli/index';
import { generateNativeTaskDeliveryOutput } from '../native/task-delivery';
import { getNativeTaskStartedPrompt } from '../native/task-started-content';
import { appendCliTaskDeliveryFooter } from '../task-delivery/cli-task-section';
import { appendTaskDeliveryHandoffSections } from '../task-delivery/core';

const TEAMS: CharacterisationTeam[] = [
  { teamId: 'duo', teamName: TEAM_PRESETS.duo.name, teamRoles: [...TEAM_PRESETS.duo.roles] },
  { teamId: 'solo', teamName: TEAM_PRESETS.solo.name, teamRoles: [...TEAM_PRESETS.solo.roles] },
  { teamId: 'trio', teamName: TEAM_PRESETS.trio.name, teamRoles: [...TEAM_PRESETS.trio.roles] },
  {
    teamId: 'characterisation-custom-team',
    teamName: 'Custom Team',
    teamRoles: ['tester', 'architect', 'builder', 'specifier'],
  },
];

const PRESET_TEAM_IDS = new Set<string>(['duo', 'solo', 'trio']);

const REMOVED_CONTEXT_COMMAND =
  /chatroom context (new|read|view-template)\b|\bcontext read\b|Context goal|Context Rule|context-read/;

const CHATROOM_ID = 'removed-context-room';

/** The entry-point role of each preset: the role that receives user tasks directly. */
const ENTRY_POINTS = (['duo', 'solo', 'trio'] as const).map((teamId) => ({
  teamId,
  teamRoles: [...TEAM_PRESETS[teamId].roles],
  role: TEAM_PRESETS[teamId].entryPoint,
}));

/**
 * Renders the entry-point surfaces a user task reaches: the CLI and native
 * task-started prompts, the native task delivery, and the task-delivery core
 * block (Chat-mode and verifier-gate area), in both conversation modes.
 */
function renderEntryPointSurfaces(entry: (typeof ENTRY_POINTS)[number]): Record<string, string> {
  const { teamId, teamRoles, role } = entry;
  const handoffTargets = teamRoles.filter((member) => member !== role);
  const message = { _id: 'removed-context-message', senderRole: 'user' };
  const task = { _id: 'removed-context-task', content: 'Task body' };
  const delivery = (conversationMode: ConversationMode): string =>
    generateNativeTaskDeliveryOutput({
      chatroomId: CHATROOM_ID,
      role,
      cliEnvPrefix: '',
      teamId,
      task,
      message,
      availableHandoffTargets: handoffTargets,
      isEntryPoint: true,
      conversationMode,
    });
  const coreLines: string[] = [];
  appendTaskDeliveryHandoffSections(coreLines, {
    chatroomId: CHATROOM_ID,
    role,
    cliEnvPrefix: '',
    teamId,
    message,
    availableHandoffTargets: handoffTargets,
    isEntryPoint: true,
    conversationMode: 'chat',
  });
  return {
    'CLI task-started prompt': getTaskStartedPrompt(),
    'native task-started prompt': getNativeTaskStartedPrompt(),
    'native task delivery (chat mode)': delivery('chat'),
    'native task delivery (code mode)': delivery('code'),
    'task-delivery core (chat mode)': coreLines.join('\n'),
  };
}

describe.each(ENTRY_POINTS)('entry-point surfaces for $teamId', (entry) => {
  const surfaces = renderEntryPointSurfaces(entry);

  test('every entry-point surface renders with content, so the assertion cannot pass vacuously', () => {
    for (const [label, rendered] of Object.entries(surfaces)) {
      expect(rendered.length, label).toBeGreaterThan(0);
    }
    expect(surfaces['native task delivery (chat mode)']).toContain('<chat-mode>');
  });

  test.each(Object.keys(surfaces))('%s names no removed command', (label) => {
    expect(surfaces[label]).not.toMatch(REMOVED_CONTEXT_COMMAND);
  });
});

/** The CLI task-delivery footer every `get-next-task` delivery ends with. */
function renderTaskFooter(role: string): string {
  const lines: string[] = [];
  appendCliTaskDeliveryFooter(lines, { chatroomId: CHATROOM_ID, role, cliEnvPrefix: '' });
  return lines.join('\n');
}

/** Render a handoff template pair, failing loudly when the catalog has no body. */
function renderPair(pair: HandoffTemplatePair): string {
  const template = renderHandoffTemplate(pair);
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

describe.each(TEAMS)('rendered prompts for $teamId', (team) => {
  const roles = rolesUnderCharacterisation(team);

  test('renders every surface with content, so the assertions cannot pass vacuously', () => {
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(renderRolePrompt(team, role).length, `role prompt for ${role}`).toBeGreaterThan(0);
      expect(renderInitSystemPrompt(team, role).length, `cli init for ${role}`).toBeGreaterThan(0);
      expect(
        renderInitSystemPrompt(team, role, 'claude-sdk').length,
        `native init for ${role}`
      ).toBeGreaterThan(0);
      expect(renderTaskFooter(role).length, `task footer for ${role}`).toBeGreaterThan(0);
    }
  });

  test.each(roles)('role %s: role prompt and both init prompts name no removed command', (role) => {
    expect(renderRolePrompt(team, role)).not.toMatch(REMOVED_CONTEXT_COMMAND);
    expect(renderInitSystemPrompt(team, role)).not.toMatch(REMOVED_CONTEXT_COMMAND);
    expect(renderInitSystemPrompt(team, role, 'claude-sdk')).not.toMatch(REMOVED_CONTEXT_COMMAND);
  });

  test.each(roles)('role %s: task-delivery footer names no removed command', (role) => {
    expect(renderTaskFooter(role)).not.toMatch(REMOVED_CONTEXT_COMMAND);
  });
});

describe('handoff templates for every preset team and role', () => {
  test('every rendered handoff template names no removed command', () => {
    let rendered = 0;

    for (const team of TEAMS.filter((candidate) => PRESET_TEAM_IDS.has(candidate.teamId))) {
      const roles = rolesUnderCharacterisation(team);
      expect(roles.length, `roles for ${team.teamId}`).toBeGreaterThan(0);

      for (const role of roles) {
        for (const pair of listHandoffTemplatePairs(team.teamId, role)) {
          expect(renderPair(pair), `${pair.teamId}:${pair.fromRole}->${pair.toRole}`).not.toMatch(
            REMOVED_CONTEXT_COMMAND
          );
          rendered += 1;
        }
      }
    }

    expect(rendered).toBeGreaterThan(0);
  });
});
