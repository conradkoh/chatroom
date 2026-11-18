import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { getPlannerGuidance } from './duo/prompts/planner';
import { getSoloGuidance } from './solo/prompts/solo';
import { getCoordinatorGuidance } from './trio/prompts/coordinator';
import { getSpecifierGuidance } from './trio/prompts/specifier';
import { getProductManagerGuidance } from '../cli/roles/product-manager';

const BASE = {
  convexUrl: 'http://127.0.0.1:3210',
  chatroomId: 'test-chatroom-id',
  nativeIntegration: false,
  isEntryPoint: true,
};

/** Rendered entry-point guidance per team, with that team's own entry-point and implementer. */
const ENTRY_POINTS = [
  [
    'trio coordinator',
    'coordinator',
    '`specifier`',
    getCoordinatorGuidance({
      ...BASE,
      role: 'coordinator',
      teamRoles: [...TEAM_PRESETS.trio.roles],
    }),
  ],
  [
    'duo planner',
    'planner',
    '`builder`',
    getPlannerGuidance({
      ...BASE,
      role: 'planner',
      teamRoles: ['planner', 'builder', 'uiux-engineer', 'product-manager'],
    }),
  ],
  [
    'solo solo',
    'solo',
    'you',
    getSoloGuidance({
      ...BASE,
      role: 'solo',
      teamRoles: ['solo', 'uiux-engineer', 'product-manager'],
    }),
  ],
] as const;

describe.each(ENTRY_POINTS)('%s routing rules', (_name, entryPoint, implementer, guidance) => {
  test('names the division of labour and the entry point', () => {
    expect(guidance).toContain(
      `**Routing rules (\`${entryPoint}\`), apply the first that matches:**`
    );
    expect(guidance).toContain('`product-manager` answers *what* and *whether*');
    expect(guidance).toContain('never designs layout');
    expect(guidance).toContain('`uiux-engineer` answers *how it looks and behaves*');
    expect(guidance).toContain('never decides scope');
  });

  test('states the six rules in order', () => {
    const markers = [
      '1. **Bug report:** goes to `triage` first.',
      '2. **New feature with undecided or ambiguous scope:** goes to `product-manager` first',
      '3. **New feature with a UI surface and agreed scope:**',
      '4. **Non-game icons, illustrations, and asset files:**',
      '5. **Backend contract, API, or schema change:** goes to `architect` first.',
      '6. **Existing UI with no new surface and no design decision:** goes straight to',
    ];
    let previous = -1;
    for (const marker of markers) {
      const index = guidance.indexOf(marker);
      expect(index, marker).toBeGreaterThan(previous);
      previous = index;
    }
  });

  test('bug reports go to triage first and skip product-manager and uiux-engineer', () => {
    expect(guidance).toContain(
      'Neither `product-manager` nor `uiux-engineer` is involved unless the fix itself needs a scope or design decision.'
    );
  });

  test('new UI features need a uiux-engineer design before UI work', () => {
    expect(guidance).toContain('a new screen, panel, flow, interaction, or visible state');
    expect(guidance).toContain('goes to `uiux-engineer` for a design before any');
    expect(guidance).toContain(
      'Do not start UI implementation of a new UI feature without that design'
    );
  });

  test('existing UI without a new surface skips uiux-engineer', () => {
    expect(guidance).toContain(`goes straight to ${implementer}, with no \`uiux-engineer\`.`);
  });

  test('asset files are never routed to product-manager or uiux-engineer', () => {
    expect(guidance).toMatch(
      /\*\*Non-game icons, illustrations, and asset files:\*\*[^\n]*`product-manager`[^\n]*`uiux-engineer`/
    );
  });

  test('applies the product-manager UI and UX review section', () => {
    expect(guidance).toContain(
      'read its `## UI and UX review` section and follow it (routing rule 3)'
    );
  });
});

describe.each(ENTRY_POINTS)('%s decision routing', (_name, entryPoint, _implementer, guidance) => {
  test('routes product decisions to product-manager and technical decisions to architect', () => {
    expect(guidance).toContain(`**Decision routing (\`${entryPoint}\`):**`);
    expect(guidance).toContain('never hand `user` a list of decisions');
    expect(guidance).toContain('Open **product** decisions');
    expect(guidance).toContain('go to `product-manager`');
    expect(guidance).toContain('Open **technical** decisions');
    expect(guidance).toContain('go to `architect`');
  });

  test('reaches user only for an ambiguous request or destructive risk', () => {
    expect(guidance).toContain('**ambiguous or insufficient request:**');
    expect(guidance).toContain('**destructive risk:**');
    expect(guidance).toContain(
      'deletion, data loss, an irreversible migration, an externally visible or production-affecting action, or spending money'
    );
  });

  test('sends one open specialist question back once, then proceeds', () => {
    expect(guidance).toContain(
      'send that one question back to the same specialist once, then proceed on its recommendation'
    );
  });

  test('falls back to the entry point when the team has no such specialist', () => {
    expect(guidance).toContain(
      'If your team composition does not list `product-manager` or `architect`, make that decision yourself, record the rationale in your handoff'
    );
  });

  test('appears after the routing rules and replaces the old user question line', () => {
    expect(guidance.indexOf('**Decision routing (')).toBeGreaterThan(
      guidance.indexOf('**Routing rules (')
    );
    expect(guidance).not.toContain('put any open question that blocks planning to `user`');
    expect(guidance).toContain(
      'settle any open question it raises under the decision-routing rule'
    );
  });
});

describe('trio and duo asset rule routes to the designer; solo handles assets itself', () => {
  test.each(ENTRY_POINTS.slice(0, 2))('%s', (_name, _entry, _impl, guidance) => {
    expect(guidance).toContain(
      'go to `game-asset-designer`, not to `product-manager` and not to `uiux-engineer`'
    );
  });

  test('solo', () => {
    expect(ENTRY_POINTS[2][3]).toContain('this team has no `game-asset-designer`');
  });
});

describe('product manager UI and UX review reminder', () => {
  test('prompt tells the product manager to remind the entry point', () => {
    const guidance = getProductManagerGuidance({
      nativeIntegration: false,
      recipientRole: 'coordinator',
    });
    expect(guidance).toContain('`## UI and UX review` section');
    expect(guidance).toContain(
      'remind `coordinator` that it must get a `uiux-engineer` design before any UI work on this new feature'
    );
    expect(guidance).toContain('Never design layout yourself');
  });
});

describe('specifier UI rule', () => {
  const guidance = getSpecifierGuidance({
    ...BASE,
    role: 'specifier',
    teamRoles: [...TEAM_PRESETS.trio.roles],
  });

  test('requires a named design message id and reports the gap to coordinator', () => {
    expect(guidance).toContain(
      '**No UI implementation of a new UI feature without a named design.**'
    );
    expect(guidance).toContain('names a design by message id in its inputs');
    expect(guidance).toContain('report the gap to `coordinator`');
  });

  test('does not tell the specifier to contact uiux-engineer or product-manager', () => {
    expect(guidance).not.toContain('hand off to `uiux-engineer`');
    expect(guidance).not.toContain('hand off to `product-manager`');
    expect(guidance).toContain('do not try to contact a specialist');
  });
});
