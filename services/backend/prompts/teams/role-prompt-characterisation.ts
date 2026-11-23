/**
 * Renders role prompts for the per-team characterisation snapshots.
 *
 * Every snapshot goes through the public composers (`generateRolePrompt`,
 * `composeInitPrompt`), so a snapshot pins the exact bytes a harness receives.
 * Test-only helper: imported by the `*-role-prompts.snapshot.test.ts` files.
 */

import { AGENT_ROLE_DEFINITIONS } from '@workspace/shared/domain/agent-role';

import { composeInitPrompt, generateRolePrompt } from '../generator';

export const CHARACTERISATION_CHATROOM_ID = 'characterisation-chatroom';
export const CHARACTERISATION_CONVEX_URL = 'http://127.0.0.1:3210';

/** Team identity as the prompt layer receives it from a room. */
export interface CharacterisationTeam {
  teamId: string;
  teamName: string;
  teamRoles: string[];
}

/** Roles outside every preset's membership: custom-role and legacy fallbacks. */
const FALLBACK_ROLES = ['tester', 'enhancer', 'designer', 'legacy-role'];

/** Every role rendered for a team: its members, every builtin role, and the fallbacks. */
export function rolesUnderCharacterisation(team: CharacterisationTeam): string[] {
  return [
    ...new Set([...team.teamRoles, ...Object.keys(AGENT_ROLE_DEFINITIONS), ...FALLBACK_ROLES]),
  ];
}

/** Per-message role prompt, as rendered by `generateRolePrompt`. */
export function renderRolePrompt(team: CharacterisationTeam, role: string): string {
  return generateRolePrompt({
    chatroomId: CHARACTERISATION_CHATROOM_ID,
    role,
    teamId: team.teamId,
    teamName: team.teamName,
    teamRoles: [...team.teamRoles],
    availableHandoffRoles: [...team.teamRoles.filter((member) => member !== role), 'user'],
    convexUrl: CHARACTERISATION_CONVEX_URL,
  });
}

/** Init system prompt, as rendered by `composeInitPrompt`. `agentHarness` undefined = CLI variant. */
export function renderInitSystemPrompt(
  team: CharacterisationTeam,
  role: string,
  agentHarness?: 'claude-sdk'
): string {
  return composeInitPrompt({
    chatroomId: CHARACTERISATION_CHATROOM_ID,
    role,
    teamId: team.teamId,
    teamName: team.teamName,
    teamRoles: [...team.teamRoles],
    convexUrl: CHARACTERISATION_CONVEX_URL,
    agentType: 'unset',
    agentHarness,
  }).systemPrompt;
}
