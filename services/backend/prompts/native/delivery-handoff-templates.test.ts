/**
 * Catalog coverage guard for native task-delivery handoff templates.
 *
 * Every role-owned outbound template must reach task delivery, addressed by
 * its exact sender → recipient pair. Triage was previously absent from
 * delivery, so its report template never arrived and the triage handoff
 * rendered as free text. The pair list derived from each contract's `returnsTo`
 * order is now the only source.
 */

import { describe, expect, test } from 'vitest';

import {
  appendNativeDeliveryHandoffTemplates,
  formatDeliveredHandoffTemplateHeading,
  getDeliveredHandoffTemplatePair,
} from './delivery-handoff-templates';
import { DUO_ROLE_HANDOFF_CATALOG } from '../teams/duo/handoff-templates';
import { SOLO_ROLE_HANDOFF_CATALOG } from '../teams/solo/handoff-templates';

const CATALOGS = [
  ['duo', DUO_ROLE_HANDOFF_CATALOG],
  ['solo', SOLO_ROLE_HANDOFF_CATALOG],
] as const;

function render(teamId: string | undefined, role: string): string {
  const lines: string[] = [];
  appendNativeDeliveryHandoffTemplates(lines, {
    teamId,
    role,
    chatroomId: 'room-id',
    cliEnvPrefix: '',
  });
  return lines.join('\n');
}

describe('appendNativeDeliveryHandoffTemplates — catalog coverage guard', () => {
  for (const [teamId, catalog] of CATALOGS) {
    for (const role of Object.keys(catalog)) {
      const contract = catalog[role as keyof typeof catalog];
      if (Object.keys(contract.outboundTemplates).length === 0) continue;

      test(`${teamId}/${role} inlines every outbound handoff template on delivery`, () => {
        const output = render(teamId, role);

        expect(output).toContain('<handoff-templates>');
        expect(output).toContain('Use these structures when handing off.');
        expect(output).toContain('</handoff-templates>');
        for (const toRole of contract.returnsTo) {
          expect(output).toContain(
            formatDeliveredHandoffTemplateHeading({ teamId, fromRole: role, toRole })
          );
        }
      });
    }
  }
});

describe('appendNativeDeliveryHandoffTemplates — pair headings in returnsTo order', () => {
  test('duo planner inlines the seven pair headings in the documented order', () => {
    const output = render('duo', 'planner');
    const headings = [...output.matchAll(/^### Handoff template `([^`]+)` → `([^`]+)`$/gm)].map(
      ([, from, to]) => `${from}→${to}`
    );

    expect(headings).toEqual([
      'planner→user',
      'planner→builder',
      'planner→architect',
      'planner→uiux-engineer',
      'planner→triage',
      'planner→researcher',
      'planner→reviewer',
      'planner→game-asset-designer',
      'planner→verifier',
    ]);
  });

  test('duo builder inlines only the builder → planner pair heading', () => {
    const output = render('duo', 'builder');
    const headings = [...output.matchAll(/^### Handoff template `([^`]+)` → `([^`]+)`$/gm)].map(
      ([, from, to]) => `${from}→${to}`
    );

    expect(headings).toEqual(['builder→planner']);
  });
});

describe('appendNativeDeliveryHandoffTemplates — pair lookup', () => {
  test('resolves a delivered pair for a known team and role', () => {
    expect(getDeliveredHandoffTemplatePair('duo', 'planner', 'builder')).toEqual({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'builder',
    });
  });

  test('normalizes a recipient with surrounding whitespace and mixed case', () => {
    expect(getDeliveredHandoffTemplatePair('duo', 'planner', '  Builder ')?.toRole).toBe('builder');
  });

  test('returns null for a recipient the role does not hand off to', () => {
    expect(getDeliveredHandoffTemplatePair('duo', 'planner', 'enhancer')).toBeNull();
  });

  test('returns null for a custom team with no pair catalog', () => {
    expect(getDeliveredHandoffTemplatePair('tri', 'planner', 'builder')).toBeNull();
  });
});

describe('appendNativeDeliveryHandoffTemplates — custom team fallback', () => {
  test('emits no <handoff-templates> block for an unknown team', () => {
    const output = render('tri', 'planner');

    expect(output).not.toContain('<handoff-templates>');
  });
});
