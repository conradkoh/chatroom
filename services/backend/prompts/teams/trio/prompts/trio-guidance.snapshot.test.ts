/**
 * Snapshot safety net for the trio team's role guidance.
 *
 * Captures the coordinator, specifier, and builder guidance in CLI and native
 * variants through the public selector dispatcher, plus the specialist
 * fallback. Any accidental prose or dispatch drift fails here.
 */

import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { getHandoffContinuityRule } from '../../../native/session-continuity';
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
    expect(guidance).toContain('`coordinator` → `specifier` is always a new session');
    expect(guidance).toContain('before any specifier delegation');
    expect(guidance).not.toContain('before any builder delegation');
    expect(guidance).toContain('`## Rework findings (prior round)`');
    expect(guidance).toContain('**Product manager before scoping a new ambiguous feature:**');
    expect(guidance).toContain('Only the entry point (`coordinator`) activates it.');
    expect(guidance).toContain('Skip it for small bug fixes, for unambiguous requests');
    expect(guidance).toContain('**Bug reports go to triage first:**');
    expect(guidance.indexOf('**Product manager before scoping')).toBeLessThan(
      guidance.indexOf('**Bug reports go to triage first:**')
    );
    expect(guidance).toContain('Record the plan id from its first report.');
    expect(guidance).toContain('remind it what the plan already delivered and what remains');
    expect(guidance).toContain('`Plan ID: None — first pass: publish the plan`');
    expect(guidance).toContain('`--supersedes` on the old plan ID');
    expect(guidance).not.toContain('copy the remaining slice plan');
    expect(guidance).toContain('**The specifier decides the work.**');
    expect(guidance).toContain('**You hold the plan.**');
    expect(guidance).toContain('after 2 failed rework rounds on a round');
    expect(guidance).not.toMatch(
      /Size each work package|Send one package at a time|One slice per specifier session/
    );
  });

  test.each(GUIDANCE_VARIANTS)('specifier guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getGuidance('specifier', nativeIntegration);

    expect(guidance).toMatchSnapshot(variant);
    expect(guidance).toContain(`chatroom messages download --chatroom-id="${CHATROOM_ID}"`);
    expect(guidance).toContain('never hand off to `user`');
    expect(guidance).toContain('Your handoff targets are `builder` and `coordinator` only');
    expect(guidance).toContain(
      'Do not use `chatroom message(s) send` — it persists `senderRole=user` and bypasses the enforced handoff graph.'
    );
    expect(guidance).not.toContain('Run `chatroom handoff --next-role=<role>`');
    expect(guidance).not.toContain('the architect designs first and you delegate');
    expect(guidance).toContain(
      'Every handoff from `coordinator` starts you in a fresh session, including rework'
    );
    expect(guidance).not.toContain('(including to `user`)');
    if (!nativeIntegration) {
      expect(guidance).toContain(
        'rebuild context from the package and the thread, including `## Rework findings (prior round)`'
      );
      expect(guidance).toContain('after any handoff, run `get-next-task`');
      expect(guidance).toContain(getHandoffContinuityRule(false, { includeUser: false }));
    }
    expect(guidance).toContain(
      `chatroom skill activate code-review --chatroom-id="${CHATROOM_ID}" --role="specifier"`
    );
    expect(guidance).toContain(
      'Rework feedback to the builder must name the file, the line where known, and the failing requirement.'
    );
    expect(guidance).toContain(
      '**Scope gaps go to `coordinator`; you never activate `product-manager`.**'
    );
    expect(guidance).toContain('do not try to contact `product-manager`');
    expect(guidance).not.toContain('**Product manager before scoping a new ambiguous feature:**');
    expect(guidance).not.toContain('hand off to `product-manager`');
    expect(guidance).toContain('Decide your round.');
    expect(guidance).toContain('chatroom plan view-template');
    expect(guidance).toContain('does not commit you to delivering it one phase at a time');
    expect(guidance).toContain('Delegation cost and batching');
    expect(guidance).not.toMatch(/one slice per|build one|Build \*\*P1 only\*\*/);
    expect(guidance).toContain('Put the plan ID from the publish output');
    expect(guidance).toContain('Never reconstruct the plan from memory or from earlier reports.');
    // The whole-plan read comes first: the specifier cannot know how many phases
    // it takes before reading the plan, so the phase read is the follow-up.
    expect(guidance).toContain(
      '(the same command without `--phase`) to choose the phases this round takes'
    );
    expect(guidance).not.toContain('For more than one phase, read the whole plan');
    const wholePlanReadIndex = guidance.indexOf('read the whole plan with `');
    const phaseFollowUpIndex = guidance.indexOf(
      'Once you have chosen a phase and need only its detail, read that phase with `'
    );
    expect(wholePlanReadIndex).toBeGreaterThan(-1);
    expect(phaseFollowUpIndex).toBeGreaterThan(wholePlanReadIndex);
    expect(guidance).toContain('--plan-id="<planId>" --phase="<Pn>"`');
    expect(guidance).toContain('**Broken reference → hand back to `coordinator`:**');
    expect(guidance).toContain('`--supersedes="<old planId>"`');
  });

  test('specifier guidance names only plan errors the CLI prints', () => {
    const guidance = getGuidance('specifier', false);

    expect(guidance).not.toContain('PHASE_NOT_FOUND');
    expect(guidance).not.toContain('PLAN_NOT_FOUND');
    expect(guidance).toContain('Phase not found: <Pn>');
    expect(guidance).toContain('Plan not found: <planId>');
  });

  test.each(GUIDANCE_VARIANTS)('builder guidance (%s)', (variant, nativeIntegration) => {
    const guidance = getGuidance('builder', nativeIntegration);

    expect(guidance).toMatchSnapshot(variant);
    expect(guidance).toContain(`chatroom messages download --chatroom-id="${CHATROOM_ID}"`);
    expect(guidance).toContain('Your only handoff target is `specifier`');
    expect(guidance.startsWith(' ')).toBe(false);
    expect(guidance.startsWith('\n')).toBe(false);
    expect(guidance).not.toContain('(including to `user`)');
  });
});

describe('trio specialist guidance fallback', () => {
  test('architect guidance hands back to the coordinator', () => {
    const guidance = getGuidance('architect', false);

    expect(guidance).toContain('--next-role="coordinator"');
  });
});
