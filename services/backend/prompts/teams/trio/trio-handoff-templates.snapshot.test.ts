import { describe, expect, test } from 'vitest';

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

describe('trio handoff template snapshots', () => {
  test.each(['code', 'chat'] as const)('trio non-specialist pairs (%s)', (mode) => {
    for (const pair of trioPairs) {
      expect(render(pair, mode)).toMatchSnapshot(`${pair.fromRole}->${pair.toRole}`);
    }
  });

  test('specifier → builder brief defers open questions to the coordinator', () => {
    const specifierToBuilder = trioPairs.find(
      (pair) => pair.fromRole === 'specifier' && pair.toRole === 'builder'
    )!;
    const body = render(specifierToBuilder, 'code');
    expect(body).toContain('hand back to `coordinator` with the open question');
    expect(body).toContain('## Shared contracts (specifier-owned)');
  });

  test('coordinator → specifier brief carries specialist inputs and history pointers', () => {
    const coordinatorToSpecifier = trioPairs.find(
      (pair) => pair.fromRole === 'coordinator' && pair.toRole === 'specifier'
    )!;
    const body = render(coordinatorToSpecifier, 'code');
    expect(body).toContain('## Inputs from specialists');
    expect(body).toContain('chatroom messages download');
  });

  test('builder → specifier handback addresses the specifier', () => {
    const builderToSpecifier = trioPairs.find(
      (pair) => pair.fromRole === 'builder' && pair.toRole === 'specifier'
    )!;
    const body = render(builderToSpecifier, 'code');
    expect(body).toContain('<anything needing specifier decision>');
  });
});
