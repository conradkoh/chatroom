/**
 * Catalog coverage guard for native task-delivery handoff templates.
 *
 * Every role-owned outbound template must reach task delivery. Triage was
 * previously absent from NATIVE_DELIVERY_TEMPLATE_TARGETS, so its report
 * template never arrived and the triage handoff rendered as free text. This
 * guard fails if any catalog role with outbound templates is not inlined.
 */

import { describe, expect, test } from 'vitest';

import { appendNativeDeliveryHandoffTemplates } from './delivery-handoff-templates';
import { DUO_ROLE_HANDOFF_CATALOG } from '../teams/duo/handoff-templates';
import { SOLO_ROLE_HANDOFF_CATALOG } from '../teams/solo/handoff-templates';

const CATALOGS = [
  ['duo', DUO_ROLE_HANDOFF_CATALOG],
  ['solo', SOLO_ROLE_HANDOFF_CATALOG],
] as const;

describe('appendNativeDeliveryHandoffTemplates — catalog coverage guard', () => {
  for (const [teamId, catalog] of CATALOGS) {
    for (const role of Object.keys(catalog)) {
      const contract = catalog[role as keyof typeof catalog];
      if (Object.keys(contract.outboundTemplates).length === 0) continue;

      test(`${teamId}/${role} inlines every outbound handoff template on delivery`, () => {
        const lines: string[] = [];
        appendNativeDeliveryHandoffTemplates(lines, {
          teamId,
          role,
          chatroomId: 'room-id',
          cliEnvPrefix: '',
        });

        const output = lines.join('\n');
        expect(output).toContain('<handoff-templates>');
        expect(output).toContain('Use these structures when handing off.');
        for (const toRole of Object.keys(contract.outboundTemplates)) {
          expect(output).toContain(`### Handoff to \`${toRole}\``);
        }
      });
    }
  }
});
