/**
 * Pure remap helpers that retire the `code:enhanced` conversation mode.
 *
 * These tests pin the agreed mapping only: `code:enhanced` → `code`,
 * `enhanced-team` → `team`, `enhancement` → `implementation`. They never derive
 * expectations from the helper itself.
 */

import { isTaskEnvelopeV1, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { describe, expect, test } from 'vitest';

import { retireEnhancedScalarMode, retireEnhancedTaskEnvelope } from './enhancedModeRetirement';

const ENHANCED_ENVELOPE: TaskEnvelopeV1 = {
  version: 1,
  conversationMode: 'code:enhanced',
  sessionPolicy: 'new',
  handoffWorkflow: { preset: 'enhanced-team', phase: 'enhancement' },
};

describe('retireEnhancedScalarMode', () => {
  test("maps 'code:enhanced' to 'code'", () => {
    expect(retireEnhancedScalarMode('code:enhanced')).toBe('code');
  });

  test.each(['chat', 'code', 'enhanced', 'code:enhanced-ish', undefined, null, 42])(
    'returns null for %p (no change)',
    (value) => {
      expect(retireEnhancedScalarMode(value)).toBeNull();
    }
  );
});

describe('retireEnhancedTaskEnvelope', () => {
  test('maps mode, preset, and phase together and the result is a valid envelope', () => {
    const result = retireEnhancedTaskEnvelope(ENHANCED_ENVELOPE);

    expect(result).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    });
    expect(isTaskEnvelopeV1(result)).toBe(true);
  });

  test('does not mutate the input envelope', () => {
    const before = structuredClone(ENHANCED_ENVELOPE);

    retireEnhancedTaskEnvelope(ENHANCED_ENVELOPE);

    expect(ENHANCED_ENVELOPE).toEqual(before);
  });

  test('maps an enhanced-team preset when the mode is already code', () => {
    const result = retireEnhancedTaskEnvelope({
      ...ENHANCED_ENVELOPE,
      conversationMode: 'code',
      handoffWorkflow: { preset: 'enhanced-team', phase: 'implementation' },
    });

    expect(result).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    });
  });

  test('maps an enhancement phase when the preset is already team', () => {
    const result = retireEnhancedTaskEnvelope({
      ...ENHANCED_ENVELOPE,
      conversationMode: 'code',
      handoffWorkflow: { preset: 'team', phase: 'enhancement' },
    });

    expect(result).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    });
  });

  test.each(['entry', 'implementation', 'delivery'] as const)(
    'leaves the %s phase unchanged',
    (phase) => {
      const result = retireEnhancedTaskEnvelope({
        ...ENHANCED_ENVELOPE,
        conversationMode: 'code',
        handoffWorkflow: { preset: 'team', phase },
      });

      expect(result).toBeNull();
    }
  );

  test('copies every other envelope field unchanged', () => {
    const extra = {
      ...ENHANCED_ENVELOPE,
      hocusPocus: { keep: true },
      handoffWorkflow: { preset: 'enhanced-team', phase: 'entry', note: 'keep' },
    };

    const result = retireEnhancedTaskEnvelope(extra);

    expect(result).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'entry', note: 'keep' },
      hocusPocus: { keep: true },
    });
  });

  test('returns null when the envelope needs no change', () => {
    expect(
      retireEnhancedTaskEnvelope({
        version: 1,
        conversationMode: 'code',
        sessionPolicy: 'continue',
        handoffWorkflow: { preset: 'team', phase: 'delivery' },
      })
    ).toBeNull();
    expect(
      retireEnhancedTaskEnvelope({
        version: 1,
        conversationMode: 'chat',
        sessionPolicy: 'continue',
        handoffWorkflow: { preset: 'direct', phase: 'entry' },
      })
    ).toBeNull();
  });

  test.each([undefined, null, 42, 'code:enhanced', [], [ENHANCED_ENVELOPE]])(
    'returns null for non-record input %p',
    (value) => {
      expect(retireEnhancedTaskEnvelope(value)).toBeNull();
    }
  );
});
