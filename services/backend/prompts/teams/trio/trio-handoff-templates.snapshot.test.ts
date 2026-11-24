import { describe, expect, test } from 'vitest';

import { trioSpecifierHandoffContract } from './handoff-templates/specifier';
import { listHandoffTemplatePairs, renderHandoffTemplate } from '../../cli/handoff-templates';

/** Permanent trio roles plus the user target; specialist pairs are snapshotted per role. */
const NON_SPECIALIST_ROLES = new Set(['coordinator', 'specifier', 'builder', 'user']);

const trioPairs = listHandoffTemplatePairs('trio').filter(
  (pair) => NON_SPECIALIST_ROLES.has(pair.fromRole) && NON_SPECIALIST_ROLES.has(pair.toRole)
);

function render(pair: (typeof trioPairs)[number], conversationMode: 'code' | 'chat'): string {
  const template = renderHandoffTemplate(pair, {
    conversationMode,
    chatroomId: 'test-chatroom-id',
  });
  if (!template) {
    throw new Error(`no handoff template for ${pair.teamId}:${pair.fromRole}->${pair.toRole}`);
  }
  return template;
}

/** Renders the specifier→coordinator body through the contract getter itself. */
function renderSpecifierToCoordinator(conversationMode: 'code' | 'chat'): string {
  const getter = trioSpecifierHandoffContract.outboundTemplates.coordinator;
  const body = getter?.({
    fromRole: 'specifier',
    toRole: 'coordinator',
    teamId: 'trio',
    role: 'specifier',
    chatroomId: 'test-chatroom-id',
    conversationMode,
  });
  if (!body) {
    throw new Error('no specifier->coordinator handoff template');
  }
  return body;
}

describe('trio handoff template snapshots', () => {
  test.each(['code', 'chat'] as const)('trio non-specialist pairs (%s)', (mode) => {
    for (const pair of trioPairs) {
      expect(render(pair, mode)).toMatchSnapshot(`${pair.fromRole}->${pair.toRole}`);
    }
  });

  test('specifier → coordinator code report covers the round and what the plan still has', () => {
    const body = renderSpecifierToCoordinator('code');

    const headings = [
      '## Summary',
      '## Template Disclosure Confirmation',
      '## What exists today',
      '## What this round delivered',
      '## Verification run',
      '## What the plan still has',
      '## Proof of Principles',
      '## Proof of Completion',
      '## Code Change Verification',
      '## Key Technical Decisions',
      '## Key Tradeoffs',
      '## Deviations from the work package',
      '## Tech Debt Observed',
      '## Unresolved Decisions',
      '## Manual steps',
      '## Notes for review',
    ];
    for (const heading of headings) {
      expect(body).toContain(heading);
    }
    const positions = headings.map((heading) => body.indexOf(heading));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    for (const absent of [
      '## Blockers / questions',
      'messages anchor',
      'messages download',
      '**Proof of verification (verifier review):**',
      '## Backlog Pending User Review Confirmation',
      'I confirm that I read the current chatroom task context',
      '## Slice delivered',
      '## Slices still to do',
      'Phase: <Pn>',
    ]) {
      expect(body).not.toContain(absent);
    }
  });

  test('plan reference: specifier → coordinator report names the plan and its phases', () => {
    const body = renderSpecifierToCoordinator('code');

    expect(body).toContain('## Plan reference');
    expect(body).toContain(
      'Plan ID: <planId> (newly published | unchanged | superseded by <planId>)'
    );
    expect(body).toContain('Phases delivered so far: <P1, …, Pn>');
    expect(body).toContain(
      'What remains: <the phases not yet delivered, or `None — plan complete`>'
    );
    expect(body.indexOf('## What the plan still has')).toBeLessThan(
      body.indexOf('## Plan reference')
    );
  });

  test('plan reference: coordinator → specifier brief cites the plan and the read command', () => {
    const coordinatorToSpecifier = trioPairs.find(
      (pair) => pair.fromRole === 'coordinator' && pair.toRole === 'specifier'
    )!;
    const body = render(coordinatorToSpecifier, 'code');

    expect(body).toContain('## Plan reference');
    expect(body).toContain('Plan ID: <planId>, or `None — first pass: publish the plan`');
    expect(body).toContain(
      'Delivered so far: <phases the plan already landed and anything left open; or `Nothing yet.`>'
    );
    expect(body).toContain(
      'chatroom plan read --chatroom-id="test-chatroom-id" --role="specifier" --plan-id="<planId>"'
    );
    expect(body).not.toContain('Phase: <Pn>');
  });

  test('specifier → coordinator chat reply is a short body, not the report', () => {
    const body = renderSpecifierToCoordinator('chat');

    expect(body).not.toContain('## ');
    expect(body).not.toContain('Proof of Principles');
    expect(body).not.toContain('handoff-proofs');
    expect(body).not.toContain('Template Disclosure Confirmation');
  });

  test('specifier → builder brief defers open questions to the coordinator', () => {
    const specifierToBuilder = trioPairs.find(
      (pair) => pair.fromRole === 'specifier' && pair.toRole === 'builder'
    )!;
    const body = render(specifierToBuilder, 'code');
    expect(body).toContain('hand back to `coordinator` with the open question');
    expect(body).toContain('## Shared contracts (specifier-owned)');
  });

  test('specifier → builder brief carries verification flags; duo planner → builder offers both scopes', () => {
    const specifierToBuilder = trioPairs.find(
      (pair) => pair.fromRole === 'specifier' && pair.toRole === 'builder'
    )!;
    expect(render(specifierToBuilder, 'code')).toContain('## Verification flags');

    const duoPlannerToBuilder = listHandoffTemplatePairs('duo').find(
      (pair) => pair.fromRole === 'planner' && pair.toRole === 'builder'
    )!;
    const duoBody = renderHandoffTemplate(duoPlannerToBuilder, {
      conversationMode: 'code',
      chatroomId: 'test-chatroom-id',
    });
    expect(duoBody).toBeTruthy();
    expect(duoBody).toContain('## Verification flags');
    expect(duoBody).toContain('Scope: <`focused` | `round-final`>');
    expect(duoBody).toContain('- `round-final` — each run covers the full scope');
  });

  test('coordinator → specifier brief carries specialist inputs and history pointers', () => {
    const coordinatorToSpecifier = trioPairs.find(
      (pair) => pair.fromRole === 'coordinator' && pair.toRole === 'specifier'
    )!;
    const body = render(coordinatorToSpecifier, 'code');
    expect(body).toContain('## Inputs from specialists');
    expect(body).toContain('chatroom messages download');
    expect(body).toContain('## Rework findings (prior round)');
    expect(body).toContain(
      'message id of the specifier, reviewer, or verifier report and the blocking findings to fix (paste each with file and line where known); or `None.`'
    );
    expect(body.indexOf('## Scope')).toBeLessThan(body.indexOf('## Rework findings (prior round)'));
    expect(body.indexOf('## Rework findings (prior round)')).toBeLessThan(
      body.indexOf('## Acceptance criteria')
    );
  });

  test('builder → specifier handback addresses the specifier', () => {
    const builderToSpecifier = trioPairs.find(
      (pair) => pair.fromRole === 'builder' && pair.toRole === 'specifier'
    )!;
    const body = render(builderToSpecifier, 'code');
    expect(body).toContain('<anything needing specifier decision>');
    expect(body).toContain('from the specifier handoff you received');
    expect(body).not.toContain('planner handoff');
  });
});
