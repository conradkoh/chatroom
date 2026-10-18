/**
 * Resolver compatibility + contract reciprocity tests for the role-owned
 * handoff template catalogs.
 */

import { describe, expect, test } from 'vitest';

import { validateRoleHandoffContracts } from './contracts';
import type { RoleHandoffContract } from './contracts';
import {
  getHandoffTemplate,
  getReplyHandoffTemplatePair,
  listHandoffTemplatePairs,
  renderHandoffTemplate,
  resolveHandoffTemplatePair,
  type HandoffTemplatePair,
  type HandoffTemplateQuery,
} from './index';
import { HandoffTemplatePairError, type HandoffTemplatePairErrorCode } from './pair';
import { getHandoffRecipientVisibilityCallout } from '../../native/handoff-visibility';
import { getBuilderToPlannerHandoffTemplate } from '../../teams/duo/handoff-templates/builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from '../../teams/duo/handoff-templates/planner-to-builder';
import { getPlannerToUserReportTemplate } from '../../teams/duo/handoff-templates/planner-to-user';
import { getSoloToUserReportTemplate } from '../../teams/solo/handoff-templates/solo-to-user';
import { getHandoffTemplateTitleLine } from '../../utils/handoff-section-guidance';

const duoQuery = (fromRole: string, toRole: string): HandoffTemplateQuery => ({
  teamId: 'duo',
  fromRole,
  toRole,
});

/**
 * Compose the rendered template the way the pair resolver does: recipient
 * callout, pair title line, then the getter body. Keeps "exact prose"
 * assertions meaningful now that getters return body text only.
 */
function composePairTemplate(
  pair: { teamId: string; fromRole: string; toRole: string },
  body: string
): string {
  return [
    getHandoffRecipientVisibilityCallout(pair.toRole),
    getHandoffTemplateTitleLine(pair),
    body,
  ].join('\n\n');
}

function expectPairError(
  fn: () => unknown,
  code: HandoffTemplatePairErrorCode
): HandoffTemplatePairError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffTemplatePairError);
    expect((error as HandoffTemplatePairError).code).toBe(code);
    return error as HandoffTemplatePairError;
  }
  throw new Error(`expected HandoffTemplatePairError(${code})`);
}

describe('getHandoffTemplate — role-owned catalog compatibility', () => {
  test('resolves every renderable permanent duo pair to its exact prose', () => {
    expect(getHandoffTemplate(duoQuery('planner', 'builder'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
        getPlannerToBuilderHandoffTemplate()
      )
    );
    expect(getHandoffTemplate(duoQuery('builder', 'planner'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'builder', toRole: 'planner' },
        getBuilderToPlannerHandoffTemplate({ role: 'builder' })
      )
    );
    expect(getHandoffTemplate(duoQuery('planner', 'user'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
        getPlannerToUserReportTemplate({ role: 'planner' })
      )
    );
  });

  test('resolves the permanent solo pair', () => {
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'user' })).toBe(
      composePairTemplate(
        { teamId: 'solo', fromRole: 'solo', toRole: 'user' },
        getSoloToUserReportTemplate({ role: 'solo' })
      )
    );
  });

  test('resolves architect and UI/UX pairs for duo and solo', () => {
    expect(getHandoffTemplate(duoQuery('planner', 'architect'))).toMatch(/module boundaries/i);
    expect(getHandoffTemplate(duoQuery('architect', 'planner'))).toMatch(/schemas/i);
    expect(getHandoffTemplate(duoQuery('planner', 'uiux-engineer'))).toMatch(
      /complete user flows|responsive details/i
    );
    expect(getHandoffTemplate(duoQuery('uiux-engineer', 'planner'))).toMatch(/UI\/UX/i);
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'architect' })).toMatch(
      /module boundaries/i
    );
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'architect', toRole: 'solo' })).toMatch(
      /schemas/i
    );
    expect(
      getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'uiux-engineer' })
    ).toMatch(/complete user flows|responsive details/i);
    expect(
      getHandoffTemplate({ teamId: 'solo', fromRole: 'uiux-engineer', toRole: 'solo' })
    ).toMatch(/UI\/UX/i);
  });

  test('configured ephemeral role pairs use the generic fallback', () => {
    expect(getHandoffTemplate(duoQuery('enhancer', 'planner'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('planner', 'enhancer'))).toBeNull();
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'enhancer' })).toBeNull();
    expect(getHandoffTemplate({ teamId: 'solo', fromRole: 'enhancer', toRole: 'solo' })).toBeNull();
  });

  test('role names are case-insensitive for fromRole and toRole', () => {
    expect(getHandoffTemplate(duoQuery('Planner', 'BUILDER'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
        getPlannerToBuilderHandoffTemplate()
      )
    );
    expect(getHandoffTemplate(duoQuery('planner', 'USER'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
        getPlannerToUserReportTemplate({ role: 'planner' })
      )
    );
  });

  test('unknown pairs remain null', () => {
    expect(getHandoffTemplate(duoQuery('builder', 'user'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('planner', 'reviewer'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('solo', 'builder'))).toBeNull();
    expect(getHandoffTemplate({ teamId: 'tri', fromRole: 'planner', toRole: 'user' })).toBeNull();
  });
});

describe('listHandoffTemplatePairs', () => {
  test('lists the 13 duo pairs in contract order', () => {
    expect(listHandoffTemplatePairs('duo')).toEqual([
      { teamId: 'duo', fromRole: 'planner', toRole: 'user' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'architect' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'uiux-engineer' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'triage' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'researcher' },
      { teamId: 'duo', fromRole: 'planner', toRole: 'verifier' },
      { teamId: 'duo', fromRole: 'builder', toRole: 'planner' },
      { teamId: 'duo', fromRole: 'architect', toRole: 'planner' },
      { teamId: 'duo', fromRole: 'researcher', toRole: 'planner' },
      { teamId: 'duo', fromRole: 'uiux-engineer', toRole: 'planner' },
      { teamId: 'duo', fromRole: 'triage', toRole: 'planner' },
      { teamId: 'duo', fromRole: 'verifier', toRole: 'planner' },
    ]);
  });

  test('lists the 9 solo pairs in contract order', () => {
    expect(listHandoffTemplatePairs('solo')).toEqual([
      { teamId: 'solo', fromRole: 'solo', toRole: 'user' },
      { teamId: 'solo', fromRole: 'solo', toRole: 'architect' },
      { teamId: 'solo', fromRole: 'solo', toRole: 'uiux-engineer' },
      { teamId: 'solo', fromRole: 'solo', toRole: 'triage' },
      { teamId: 'solo', fromRole: 'solo', toRole: 'verifier' },
      { teamId: 'solo', fromRole: 'architect', toRole: 'solo' },
      { teamId: 'solo', fromRole: 'uiux-engineer', toRole: 'solo' },
      { teamId: 'solo', fromRole: 'triage', toRole: 'solo' },
      { teamId: 'solo', fromRole: 'verifier', toRole: 'solo' },
    ]);
  });

  test('filters by fromRole and returns [] for unknown teams/roles', () => {
    expect(listHandoffTemplatePairs('duo', 'builder')).toEqual([
      { teamId: 'duo', fromRole: 'builder', toRole: 'planner' },
    ]);
    expect(listHandoffTemplatePairs('tri')).toEqual([]);
    expect(listHandoffTemplatePairs('duo', 'user')).toEqual([]);
    expect(listHandoffTemplatePairs('duo', 'nobody')).toEqual([]);
  });

  test('every listed pair renders a non-null template', () => {
    for (const pair of [...listHandoffTemplatePairs('duo'), ...listHandoffTemplatePairs('solo')]) {
      expect(renderHandoffTemplate(pair)).toMatch(/\S/);
    }
  });
});

describe('renderHandoffTemplate — callout and pair-title invariants', () => {
  const ALL_PAIRS = [
    ...listHandoffTemplatePairs('duo'),
    ...listHandoffTemplatePairs('solo'),
  ] as const;

  test('covers every permanent pair (13 duo + 9 solo)', () => {
    expect(ALL_PAIRS).toHaveLength(22);
  });

  for (const pair of ALL_PAIRS) {
    const label = `${pair.teamId}:${pair.fromRole}->${pair.toRole}`;

    test(`${label} starts with the callout then exactly one pair title line`, () => {
      const template = renderHandoffTemplate(pair);
      expect(template).not.toBeNull();
      const rendered = template as string;

      expect(
        rendered.startsWith(
          `${getHandoffRecipientVisibilityCallout(pair.toRole)}\n\n${getHandoffTemplateTitleLine(pair)}`
        )
      ).toBe(true);

      // Exactly one title line: the resolver's. Getters no longer emit their own.
      expect(rendered.match(/^Handoff template `/gm) ?? []).toHaveLength(1);
      expect(rendered).not.toContain('Handoff template for');
      expect(rendered).not.toContain('<entry-point-role>');
    });

    test(`${label} embeds only pair-scoped handoff commands`, () => {
      const rendered = renderHandoffTemplate(pair) as string;
      const matches = [...rendered.matchAll(/--role="([^"]+)" --next-role="([^"]+)"/g)];

      for (const match of matches) {
        const [, from, to] = match;
        // A template only ever instructs one of its two roles to send. Reports
        // additionally embed a sender-scoped command to a later target (verifier).
        expect([pair.fromRole, pair.toRole], `${label} command ${from} → ${to}`).toContain(from);
        if (to === pair.toRole) {
          expect(from, `${label} addressed send command ${from} → ${to}`).toBe(pair.fromRole);
        }
      }
    });
  }

  test('delegation brief and user report are distinct for duo planner → {builder,user}', () => {
    const delegation = renderHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'builder',
    }) as string;
    const report = renderHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
    }) as string;

    expect(delegation).toContain('Delegation Brief');
    expect(delegation).not.toContain('Template Disclosure Confirmation');
    expect(report).toContain('Template Disclosure Confirmation');
    expect(report).not.toContain('Delegation Brief');
  });
});

describe('resolveHandoffTemplatePair', () => {
  test('normalizes an explicit pair and defaults/prefers explicit flags over legacy ones', () => {
    expect(
      resolveHandoffTemplatePair(
        { from: ' Planner ', to: 'BUILDER', teamId: 'DUO', legacyRole: 'x', legacyNextRole: 'y' },
        'view-template'
      )
    ).toEqual({ teamId: 'duo', fromRole: 'planner', toRole: 'builder' });
  });

  test('throws MISSING_PAIR with the missing flag list', () => {
    expect(
      expectPairError(
        () => resolveHandoffTemplatePair({ teamId: 'duo' }, 'view-template'),
        'MISSING_PAIR'
      ).message
    ).toContain('(missing: --from, --to).');
    expect(
      expectPairError(
        () => resolveHandoffTemplatePair({ to: 'builder', teamId: 'duo' }, 'view-template'),
        'MISSING_PAIR'
      ).message
    ).toContain('(missing: --from).');
    expect(
      expectPairError(
        () => resolveHandoffTemplatePair({ from: 'planner', teamId: 'duo' }, 'view-template'),
        'MISSING_PAIR'
      ).message
    ).toContain('(missing: --to).');
  });

  test('throws LEGACY_ROLE_FLAGS for legacy role flags', () => {
    expect(
      expectPairError(
        () => resolveHandoffTemplatePair({ legacyRole: 'planner', teamId: 'duo' }, 'view-template'),
        'LEGACY_ROLE_FLAGS'
      ).message
    ).toContain('no longer accepts --role/--next-role');
    expectPairError(
      () =>
        resolveHandoffTemplatePair({ legacyNextRole: 'builder', teamId: 'duo' }, 'view-template'),
      'LEGACY_ROLE_FLAGS'
    );
    expectPairError(
      () =>
        resolveHandoffTemplatePair(
          { legacyRole: 'planner', legacyNextRole: 'builder', teamId: 'duo' },
          'view-template'
        ),
      'LEGACY_ROLE_FLAGS'
    );
  });

  test('throws UNKNOWN_TEAM, UNKNOWN_FROM_ROLE, and UNKNOWN_PAIR in precedence order', () => {
    const unknownTeam = expectPairError(
      () =>
        resolveHandoffTemplatePair({ from: 'planner', to: 'user', teamId: 'tri' }, 'view-template'),
      'UNKNOWN_TEAM'
    );
    expect(unknownTeam.message).toBe('Unknown team "tri". Known teams: duo, solo.');

    const unknownFrom = expectPairError(
      () =>
        resolveHandoffTemplatePair({ from: 'user', to: 'planner', teamId: 'duo' }, 'view-template'),
      'UNKNOWN_FROM_ROLE'
    );
    expect(unknownFrom.message).toContain('Role "user" has no handoff templates in team "duo".');

    const unknownPair = expectPairError(
      () =>
        resolveHandoffTemplatePair({ from: 'planner', to: 'solo', teamId: 'duo' }, 'view-template'),
      'UNKNOWN_PAIR'
    );
    expect(unknownPair.message).toContain(
      'No handoff template for "planner" → "solo" in team "duo".'
    );
  });
});

describe('getReplyHandoffTemplatePair', () => {
  const duo = (fromRole: string, toRole: string): HandoffTemplatePair => ({
    teamId: 'duo',
    fromRole,
    toRole,
  });

  test('builder→planner replies with planner→builder and vice versa', () => {
    expect(getReplyHandoffTemplatePair(duo('builder', 'planner'))).toEqual(
      duo('planner', 'builder')
    );
    expect(getReplyHandoffTemplatePair(duo('planner', 'builder'))).toEqual(
      duo('builder', 'planner')
    );
  });

  test('terminal user targets have no reply pair', () => {
    expect(getReplyHandoffTemplatePair(duo('planner', 'user'))).toBeNull();
  });
});

describe('getHandoffTemplate — pair resolver facade', () => {
  test('returns null for unknown team/pair and non-null for valid pairs', () => {
    expect(getHandoffTemplate({ teamId: 'tri', fromRole: 'planner', toRole: 'user' })).toBeNull();
    expect(getHandoffTemplate(duoQuery('user', 'planner'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('planner', 'solo'))).toBeNull();
    expect(getHandoffTemplate(duoQuery('planner', 'builder'))).toBe(
      composePairTemplate(
        { teamId: 'duo', fromRole: 'planner', toRole: 'builder' },
        getPlannerToBuilderHandoffTemplate()
      )
    );
  });
});

describe('validateRoleHandoffContracts', () => {
  test('accepts a valid reciprocal duo-style catalog', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: ['user', 'builder'],
        returnsTo: ['builder', 'user'],
        outboundTemplates: { builder: () => 'b', user: () => 'u' },
      },
      {
        role: 'builder',
        receivesFrom: ['planner'],
        returnsTo: ['planner'],
        outboundTemplates: { planner: () => 'p' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).not.toThrow();
  });

  test('rejects an outbound target that is neither user nor a catalog role', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['builder'],
        outboundTemplates: { builder: () => 'b' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(
      /neither 'user' nor a role listed in the catalogue/i
    );
  });

  test('rejects a missing reciprocal receivesFrom declaration with a descriptive message', () => {
    const contracts: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['builder', 'user'],
        outboundTemplates: { builder: () => 'b', user: () => 'u' },
      },
      {
        role: 'builder',
        receivesFrom: [], // missing reciprocal declaration for planner
        returnsTo: ['planner'],
        outboundTemplates: { planner: () => 'p' },
      },
    ];
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(/Reciprocity failure/i);
    expect(() => validateRoleHandoffContracts(contracts)).toThrow(/does not declare "planner"/i);
  });

  test('rejects duplicate role contracts', () => {
    const duplicate: readonly RoleHandoffContract[] = [
      {
        role: 'planner',
        receivesFrom: [],
        returnsTo: ['user'],
        outboundTemplates: { user: () => 'u' },
      },
      {
        role: 'Planner',
        receivesFrom: [],
        returnsTo: ['user'],
        outboundTemplates: { user: () => 'u' },
      },
    ];
    expect(() => validateRoleHandoffContracts(duplicate)).toThrow(
      /Duplicate role handoff contract/i
    );
  });
});
