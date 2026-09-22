/**
 * Ensures delivered templates cannot prematurely terminate bash heredocs or
 * confuse structured stdin parsers when pasted into handoff/backlog/context bodies.
 */

import { describe, expect, test } from 'vitest';

import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { findReservedDelimiterLines } from '../../../prompts/cli/stdin-heredoc';
import { getHandoffRecipientVisibilityCallout } from '../../../prompts/native/handoff-visibility';

const DUO_HANDOFF_PAIRS = [
  { fromRole: 'planner', toRole: 'builder' },
  { fromRole: 'planner', toRole: 'user' },
  { fromRole: 'builder', toRole: 'planner' },
] as const;

const SOLO_HANDOFF_PAIRS = [{ fromRole: 'solo', toRole: 'user' }] as const;

function assertNoReservedDelimiterLines(label: string, content: string): void {
  const hits = findReservedDelimiterLines(content);
  expect(hits, `${label} must not contain reserved delimiter lines: ${hits.join(', ')}`).toEqual(
    []
  );
}

describe('template delimiter safety', () => {
  for (const pair of DUO_HANDOFF_PAIRS) {
    for (const nativeIntegration of [false, true] as const) {
      test(`duo ${pair.fromRole} → ${pair.toRole} (native=${nativeIntegration})`, () => {
        const template = getHandoffTemplate({ teamId: 'duo', ...pair, nativeIntegration });
        expect(template).not.toBeNull();
        assertNoReservedDelimiterLines(
          `duo:${pair.fromRole}:${pair.toRole}:native=${nativeIntegration}`,
          template!
        );
      });
    }
  }

  for (const pair of SOLO_HANDOFF_PAIRS) {
    test(`solo ${pair.fromRole} → ${pair.toRole}`, () => {
      const template = getHandoffTemplate({ teamId: 'solo', ...pair });
      expect(template).not.toBeNull();
      assertNoReservedDelimiterLines(`solo:${pair.fromRole}:${pair.toRole}`, template!);
    });
  }

  test('handoff recipient visibility callouts avoid reserved delimiters', () => {
    for (const toRole of ['user', 'builder', 'planner'] as const) {
      assertNoReservedDelimiterLines(
        `visibility:${toRole}`,
        getHandoffRecipientVisibilityCallout(toRole)
      );
    }
  });
});
