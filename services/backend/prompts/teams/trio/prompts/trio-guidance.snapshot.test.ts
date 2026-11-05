/**
 * Snapshot safety net for the trio team's role guidance.
 *
 * Captures the coordinator, specifier, and builder guidance in CLI and native
 * variants through the public selector dispatcher, plus the specialist
 * fallback. Any accidental prose or dispatch drift fails here.
 */

import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { buildSelectorContext, getRoleGuidanceFromContext } from '../../../selector-context';

const CHATROOM_ID = 'test-chatroom-id';
const CONVEX_URL = 'http://127.0.0.1:3210';

/** Trio's configured roles, copied out of the readonly preset. */
const TRIO_TEAM_ROLES = [...TEAM_PRESETS.trio.roles];

/** Guidance variant: CLI harness versus native task injection. */
const GUIDANCE_VARIANTS = [
  ['cli', false],
  ['native', true],
] as const;

function getGuidance(role: string, nativeIntegration: boolean): string {
  return getRoleGuidanceFromContext(
    buildSelectorContext({
      role,
      teamRoles: TRIO_TEAM_ROLES,
      teamName: 'Trio',
      teamId: 'trio',
      convexUrl: CONVEX_URL,
      chatroomId: CHATROOM_ID,
      nativeIntegration,
    })
  );
}

describe('trio role guidance', () => {
  test.each(GUIDANCE_VARIANTS)('coordinator guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getGuidance('coordinator', nativeIntegration);

    expect(guidance).toMatchSnapshot(variant);
    expect(guidance).toContain(`chatroom messages download --chatroom-id="${CHATROOM_ID}"`);
    expect(guidance).toContain('**Never hand off to `builder`.**');
    expect(guidance).toContain('**Only you can hand off to `user`**');
  });

  test.each(GUIDANCE_VARIANTS)('specifier guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getGuidance('specifier', nativeIntegration);

    expect(guidance).toMatchSnapshot(variant);
    expect(guidance).toContain(`chatroom messages download --chatroom-id="${CHATROOM_ID}"`);
    expect(guidance).toContain('never hand off to `user`');
    expect(guidance).toContain('Your handoff targets are `builder` and `coordinator` only');
    expect(guidance).not.toContain('Run `chatroom handoff --next-role=<role>`');
    expect(guidance).not.toContain('the architect designs first and you delegate');
    expect(guidance).toContain(
      'Every handoff from `coordinator` starts you in a fresh session, including rework'
    );
  });

  test.each(GUIDANCE_VARIANTS)('builder guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getGuidance('builder', nativeIntegration);

    expect(guidance).toMatchSnapshot(variant);
    expect(guidance).toContain(`chatroom messages download --chatroom-id="${CHATROOM_ID}"`);
    expect(guidance).toContain('Your only handoff target is `specifier`');
  });
});

describe('trio specialist guidance fallback', () => {
  test('architect guidance hands back to the coordinator', () => {
    const guidance = getGuidance('architect', false);

    expect(guidance).toContain('--next-role="coordinator"');
  });
});
