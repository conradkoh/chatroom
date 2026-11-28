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

/** Rendered entry-point guidance per team, keyed by team name so a reorder cannot swap teams. */
const ENTRY_POINTS = {
  trio: [
    'trio coordinator',
    'coordinator',
    '`specifier`',
    getCoordinatorGuidance({
      ...BASE,
      role: 'coordinator',
      teamRoles: [...TEAM_PRESETS.trio.roles],
    }),
  ],
  duo: [
    'duo planner',
    'planner',
    '`builder`',
    getPlannerGuidance({
      ...BASE,
      role: 'planner',
      teamRoles: ['planner', 'builder', 'uiux-engineer', 'product-manager'],
    }),
  ],
  solo: [
    'solo solo',
    'solo',
    'you',
    getSoloGuidance({
      ...BASE,
      role: 'solo',
      teamRoles: ['solo', 'uiux-engineer', 'product-manager'],
    }),
  ],
} as const;

/** Every entry-point fixture, in report order. Individual tests select by the named keys above. */
const ENTRY_POINT_FIXTURES = [ENTRY_POINTS.trio, ENTRY_POINTS.duo, ENTRY_POINTS.solo] as const;

describe.each(ENTRY_POINT_FIXTURES)(
  '%s routing rules',
  (_name, entryPoint, implementer, guidance) => {
    test('names the division of labour and the entry point', () => {
      expect(guidance).toContain(
        `**Routing rules (\`${entryPoint}\`), apply the first that matches:**`
      );
      expect(guidance).toContain('`product-manager` answers *what* and *whether*');
      expect(guidance).toContain('never designs layout');
      expect(guidance).toContain('`uiux-engineer` answers *how it looks and behaves*');
      expect(guidance).toContain('never decides scope');
    });

    test('states the seven rules in order', () => {
      const markers = [
        '1. **Bug report:** goes to `triage` first.',
        '2. **New feature to build, with undecided or ambiguous scope:** goes to `product-manager` first',
        '3. **New feature with a UI surface and agreed scope:**',
        '4. **Non-game icons, illustrations, and asset files:**',
        '5. **Backend contract, API, or schema change:** goes to `architect` first.',
        '6. **Agent-facing prompt text that needs a design decision:** ',
        '7. **Existing UI with no new surface and no design decision:** goes straight to',
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
  }
);

describe.each(ENTRY_POINT_FIXTURES)(
  '%s decision routing',
  (_name, entryPoint, _implementer, guidance) => {
    test('routes product decisions to product-manager and technical decisions to architect', () => {
      expect(guidance).toContain(`**Decision routing (\`${entryPoint}\`):**`);
      expect(guidance).toContain('do not bundle open decisions into a list for `user`');
      expect(guidance).toContain('Open **product** decisions');
      expect(guidance).toContain('go to `product-manager`');
      expect(guidance).toContain('Open **technical** decisions');
      expect(guidance).toContain('go to `architect`');
    });

    test('scopes routing to delegated development work and leaves conversation with the entry point', () => {
      expect(guidance).toContain(
        'govern delegated development work: a request to change code, behavior, or docs in this repository'
      );
      expect(guidance).toContain(
        'Conversation is yours: answer questions, explanations, opinions, brainstorming, status, the wording of your own reply, and non-development topics yourself, without routing them to a specialist'
      );
      expect(guidance).toContain('ask one focused question in chat, not a list');
      expect(guidance).toContain(
        'Conversation that is not delegated development work is not routed under this rule.'
      );
    });

    test('has no absolute ban on conversation or product-defaults routing', () => {
      expect(guidance).not.toContain('never hand `user` a list of decisions');
      const rule = guidance.slice(
        guidance.indexOf('**Decision routing ('),
        guidance.indexOf('**Product manager before scoping')
      );
      expect(rule).not.toMatch(/\bnever\b/i);
      expect(rule).not.toContain('product defaults');
    });

    test('product-manager gate triggers on a request to build, not on feature talk', () => {
      expect(guidance).toContain(
        'when the user asks for a new feature to be built in this repository and its scope is ambiguous or undecided'
      );
      expect(guidance).toContain(
        'A question, an opinion, or brainstorming about a possible feature is conversation: answer it yourself, without a handoff.'
      );
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
  }
);

describe.each(ENTRY_POINT_FIXTURES)(
  '%s prompt-engineer routing',
  (_name, _entry, _impl, guidance) => {
    test('routes agent-facing prompt text through the prompt engineer', () => {
      expect(guidance).toContain('goes to `prompt-engineer` for a prompt-change brief');
      expect(guidance).toContain('Rule 5 applies first');
    });
  }
);

describe('prompt engineer routing is team-correct', () => {
  const trio = ENTRY_POINTS.trio[3];
  const duo = ENTRY_POINTS.duo[3];
  const solo = ENTRY_POINTS.solo[3];

  test('trio and duo pass the proposed text to the implementation role', () => {
    expect(trio).toContain('before any `specifier` delegation; pass its proposed text verbatim');
    expect(duo).toContain('before any `builder` delegation; pass its proposed text verbatim');
  });

  test('solo applies the proposed text itself', () => {
    expect(solo).toContain('before you edit it; apply its proposed text verbatim');
    expect(solo).toContain('goes straight to you');
  });

  test('duo and trio product-manager gate names the prompt engineer', () => {
    expect(duo).toContain('any researcher, architect, prompt-engineer, or');
    expect(trio).toContain('any researcher, architect, prompt-engineer, or');
  });
});

describe('trio and duo asset rule routes to the designer; solo handles assets itself', () => {
  test.each([ENTRY_POINTS.trio, ENTRY_POINTS.duo])('%s', (_name, _entry, _impl, guidance) => {
    expect(guidance).toContain(
      'go to `game-asset-designer`, not to `product-manager` and not to `uiux-engineer`'
    );
  });

  test('solo', () => {
    expect(ENTRY_POINTS.solo[3]).toContain('this team has no `game-asset-designer`');
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
