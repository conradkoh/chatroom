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

function renderAny(teamId: 'duo' | 'solo' | 'trio', fromRole: string, toRole: string): string {
  const pair = listHandoffTemplatePairs(teamId).find(
    (candidate) => candidate.fromRole === fromRole && candidate.toRole === toRole
  );
  if (!pair) {
    throw new Error(`no handoff template pair for ${teamId}:${fromRole}->${toRole}`);
  }
  const template = renderHandoffTemplate(pair, {
    conversationMode: 'code',
    chatroomId: 'test-chatroom-id',
  });
  if (!template) {
    throw new Error(`no handoff template for ${teamId}:${fromRole}->${toRole}`);
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

  test('specifier → coordinator code report covers the package and its plan phases', () => {
    const body = renderSpecifierToCoordinator('code');

    const headings = [
      '## Summary',
      '## Delivery status',
      '## Template Disclosure Confirmation',
      '## What exists today',
      '## What this package delivered',
      '## Not delivered',
      '## Verification run',
      '## Plan phases',
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
      '## What the plan still has',
      '## Plan reference',
      'rework rounds',
    ]) {
      expect(body).not.toContain(absent);
    }
  });

  test('plan phases: specifier → coordinator report states the plan and its phases', () => {
    const body = renderSpecifierToCoordinator('code');

    expect(body).toContain('## Plan phases');
    expect(body).toContain('Phases met: <Pn…>');
    expect(body).toContain('Phases not met: <Pn…>');
    expect(body).not.toContain('## Plan reference');
  });

  test('plan phases: coordinator → specifier brief cites the plan phases and the phase read command', () => {
    const body = renderAny('trio', 'coordinator', 'specifier');

    expect(body).toContain('## Plan phases');
    expect(body).toContain('Plan ID: <planId>, or `None — no plan for this task`');
    expect(body).toContain('Phases in this package: <planId>#Pn, … ; or `None.`');
    expect(body).toContain('## Prior deliveries');
    expect(body).toContain(
      'chatroom plan read --chatroom-id="test-chatroom-id" --role="specifier" --plan-id="<planId>" --phase="<Pn>"'
    );
    expect(body).not.toContain('first pass');
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
    expect(body).toContain('## Rework findings (prior delivery)');
    expect(body).toContain(
      'message id of the specifier, reviewer, or verifier report and the blocking findings to fix (paste each with file and line where known); or `None.`'
    );
    expect(body.indexOf('## Scope')).toBeLessThan(
      body.indexOf('## Rework findings (prior delivery)')
    );
    expect(body.indexOf('## Rework findings (prior delivery)')).toBeLessThan(
      body.indexOf('## Acceptance criteria')
    );
  });

  test('trio coordinator → specialist requests carry the optional plan paragraph', () => {
    for (const role of ['architect', 'product-manager']) {
      expect(renderAny('trio', 'coordinator', role)).toContain('Plan: required');
    }
  });

  test('trio specialist → coordinator reports carry the plan-publishing instruction', () => {
    for (const role of ['architect', 'product-manager']) {
      const body = renderAny('trio', role, 'coordinator');
      expect(body).toContain('chatroom plan view-template');
      expect(body).toContain(
        `chatroom plan publish --chatroom-id="test-chatroom-id" --role="${role}"`
      );
      expect(body).toContain('Plan ID: <planId>');
    }
  });

  test('duo and solo specialist templates do not carry plan publishing', () => {
    expect(renderAny('duo', 'planner', 'architect')).not.toContain('chatroom plan publish');
    expect(renderAny('solo', 'solo', 'architect')).not.toContain('chatroom plan publish');
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
