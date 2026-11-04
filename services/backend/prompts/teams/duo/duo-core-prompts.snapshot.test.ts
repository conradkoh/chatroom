/**
 * Snapshot safety net for the duo team's core prompts.
 *
 * Captures the exact text of the planner/builder guidance (CLI and native
 * variants), the core handoff pair bodies in both conversation modes, and the
 * specialist guidance resolved through the public dispatcher. Any accidental
 * prose drift in these surfaces fails the test instead of changing a prompt.
 */

import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { renderHandoffTemplate } from '../../cli/handoff-templates';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../../selector-context';
import { getBuilderGuidance } from './prompts/builder';
import { getPlannerGuidance } from './prompts/planner';

const CHATROOM_ID = 'test-chatroom-id';
const CONVEX_URL = 'http://127.0.0.1:3210';

/** Duo's configured roles, copied out of the readonly preset. */
const DUO_TEAM_ROLES = [...TEAM_PRESETS.duo.roles];

/** Guidance variant: CLI harness versus native task injection. */
const GUIDANCE_VARIANTS = [
  ['cli', false],
  ['native', true],
] as const;

/** Core pairs whose bodies must stay byte-identical. */
const CORE_PAIRS = [
  ['planner', 'builder'],
  ['builder', 'planner'],
  ['planner', 'user'],
] as const;

/** Specialist roles the duo team resolves through the base-guidance fallback. */
const SPECIALIST_ROLES = ['researcher', 'reviewer', 'game-asset-designer'] as const;

function renderDuoPair(
  fromRole: string,
  toRole: string,
  conversationMode: 'code' | 'chat'
): string {
  const template = renderHandoffTemplate(
    { teamId: 'duo', fromRole, toRole },
    { conversationMode, chatroomId: CHATROOM_ID }
  );
  if (!template) {
    throw new Error(`no handoff template for duo:${fromRole}->${toRole}`);
  }
  return template;
}

describe('duo core handoff pairs', () => {
  test.each([['code'], ['chat']] as const)('duo core pairs (%s)', (mode) => {
    for (const [fromRole, toRole] of CORE_PAIRS) {
      expect(renderDuoPair(fromRole, toRole, mode)).toMatchSnapshot(`${fromRole}->${toRole}`);
    }
  });
});

describe('duo planner guidance', () => {
  test.each(GUIDANCE_VARIANTS)('planner guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: DUO_TEAM_ROLES,
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      chatroomId: CHATROOM_ID,
      nativeIntegration,
    });

    expect(guidance).toMatchSnapshot(variant);
  });
});

describe('duo builder guidance', () => {
  test.each(GUIDANCE_VARIANTS)('builder guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: DUO_TEAM_ROLES,
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      nativeIntegration,
    });

    expect(guidance).toMatchSnapshot(variant);
  });
});

describe('duo specialist guidance', () => {
  test.each(SPECIALIST_ROLES)('%s guidance', (role) => {
    const guidance = getRoleGuidanceFromContext(
      buildSelectorContext({
        role,
        teamRoles: DUO_TEAM_ROLES,
        teamName: 'Duo',
        teamId: 'duo',
        convexUrl: CONVEX_URL,
      })
    );

    expect(guidance).toMatchSnapshot();
  });
});
