import { describe, expect, test } from 'vitest';

import {
  advanceTaskEnvelopeWorkflow,
  createTaskEnvelope,
  HANDOFF_WORKFLOW_PHASES,
  HANDOFF_WORKFLOW_PRESETS,
  isTaskEnvelopeV1,
  normalizeTaskEnvelope,
  TASK_ENVELOPE_VERSION,
  withTaskEnvelopeConversationMode,
  withTaskEnvelopeSessionPolicy,
  type TaskEnvelopeV1,
} from './task-envelope';

function copyEnvelope(envelope: TaskEnvelopeV1): TaskEnvelopeV1 {
  return {
    version: envelope.version,
    conversationMode: envelope.conversationMode,
    sessionPolicy: envelope.sessionPolicy,
    handoffWorkflow: {
      preset: envelope.handoffWorkflow.preset,
      phase: envelope.handoffWorkflow.phase,
    },
  };
}

describe('TaskEnvelopeV1 constants and creation', () => {
  test('TASK_ENVELOPE_VERSION is 1', () => {
    expect(TASK_ENVELOPE_VERSION).toBe(1);
  });

  test('HANDOFF_WORKFLOW_PRESETS has exactly two legal values in order', () => {
    expect(HANDOFF_WORKFLOW_PRESETS).toEqual(['direct', 'team']);
  });

  test('HANDOFF_WORKFLOW_PHASES has exactly three legal values in order', () => {
    expect(HANDOFF_WORKFLOW_PHASES).toEqual(['entry', 'implementation', 'delivery']);
  });

  test('default creation is code + continue + team/entry workflow', () => {
    const envelope = createTaskEnvelope();
    expect(envelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'entry' },
    });
  });

  test('each mode maps to its default preset and the entry phase', () => {
    const expectedPreset = {
      chat: 'direct',
      code: 'team',
    } as const;
    for (const mode of ['chat', 'code'] as const) {
      const envelope = createTaskEnvelope({ conversationMode: mode });
      expect(envelope.conversationMode).toBe(mode);
      expect(envelope.handoffWorkflow).toEqual({
        preset: expectedPreset[mode],
        phase: 'entry',
      });
    }
  });

  test('explicit new session policy is retained', () => {
    const envelope = createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'new' });
    expect(envelope.sessionPolicy).toBe('new');
    expect(envelope.conversationMode).toBe('chat');
    expect(envelope.handoffWorkflow.preset).toBe('direct');
  });
});

describe('TaskEnvelopeV1 runtime validation', () => {
  test('accepts a valid envelope', () => {
    const valid = createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'new' });
    expect(isTaskEnvelopeV1(valid)).toBe(true);
  });

  test('rejects null, undefined, primitives, and arrays', () => {
    expect(isTaskEnvelopeV1(null)).toBe(false);
    expect(isTaskEnvelopeV1(undefined)).toBe(false);
    expect(isTaskEnvelopeV1(42)).toBe(false);
    expect(isTaskEnvelopeV1('chat')).toBe(false);
    expect(isTaskEnvelopeV1([])).toBe(false);
    expect(isTaskEnvelopeV1([createTaskEnvelope()])).toBe(false);
  });

  test('rejects a wrong version', () => {
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), version: 2 })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), version: '1' })).toBe(false);
  });

  test('rejects an invalid conversation mode', () => {
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), conversationMode: 'codex' })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), conversationMode: undefined })).toBe(false);
  });

  test('rejects an invalid session policy', () => {
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), sessionPolicy: 'replace' })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), sessionPolicy: undefined })).toBe(false);
  });

  test('rejects an invalid preset or phase', () => {
    expect(
      isTaskEnvelopeV1({
        ...createTaskEnvelope(),
        handoffWorkflow: { preset: 'review', phase: 'entry' },
      })
    ).toBe(false);
    expect(
      isTaskEnvelopeV1({
        ...createTaskEnvelope(),
        handoffWorkflow: { preset: 'team', phase: 'deployed' },
      })
    ).toBe(false);
  });

  test('rejects a missing or malformed workflow', () => {
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), handoffWorkflow: undefined })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), handoffWorkflow: null })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), handoffWorkflow: {} })).toBe(false);
    expect(isTaskEnvelopeV1({ ...createTaskEnvelope(), handoffWorkflow: [] })).toBe(false);
  });

  test('rejects a mode/preset mismatch', () => {
    const base = createTaskEnvelope();
    expect(
      isTaskEnvelopeV1({
        ...base,
        conversationMode: 'chat',
        handoffWorkflow: { preset: 'team', phase: 'entry' },
      })
    ).toBe(false);
    expect(
      isTaskEnvelopeV1({
        ...base,
        conversationMode: 'code',
        handoffWorkflow: { preset: 'direct', phase: 'entry' },
      })
    ).toBe(false);
  });

  test('rejects the retired mode, preset, and phase literals', () => {
    const base: Record<string, unknown> = { ...createTaskEnvelope() };
    expect(isTaskEnvelopeV1({ ...base, conversationMode: 'code:enhanced' })).toBe(false);
    expect(
      isTaskEnvelopeV1({ ...base, handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' } })
    ).toBe(false);
    expect(
      isTaskEnvelopeV1({ ...base, handoffWorkflow: { preset: 'team', phase: 'enhancement' } })
    ).toBe(false);
  });

  test('accepts every canonical mode/preset combination', () => {
    for (const mode of ['chat', 'code'] as const) {
      const envelope = createTaskEnvelope({ conversationMode: mode });
      expect(isTaskEnvelopeV1(envelope)).toBe(true);
    }
  });

  test('accepts valid workflow phases beyond entry for a preset', () => {
    const base = createTaskEnvelope(); // code → team
    expect(
      isTaskEnvelopeV1({
        ...base,
        handoffWorkflow: { preset: 'team', phase: 'implementation' },
      })
    ).toBe(true);
  });
});

describe('TaskEnvelopeV1 legacy normalization', () => {
  test('every legacy mode/session combination produces a complete envelope', () => {
    const modes = ['chat', 'code', undefined] as const;
    for (const conversationMode of modes) {
      for (const startInNewSession of [undefined, false, true]) {
        const envelope = normalizeTaskEnvelope({ conversationMode, startInNewSession });
        expect(isTaskEnvelopeV1(envelope)).toBe(true);
        expect(envelope.sessionPolicy).toBe(startInNewSession === true ? 'new' : 'continue');
        expect(envelope.conversationMode).toBe(conversationMode ?? 'code');
      }
    }
  });

  test('an omitted conversation mode defaults to historical code', () => {
    expect(normalizeTaskEnvelope({}).conversationMode).toBe('code');
  });

  test('a retired conversation mode throws TypeError', () => {
    expect(() => normalizeTaskEnvelope({ conversationMode: 'code:enhanced' as never })).toThrow(
      TypeError
    );
    expect(() =>
      normalizeTaskEnvelope({
        taskEnvelope: {
          ...createTaskEnvelope(),
          conversationMode: 'code:enhanced',
        },
      })
    ).toThrow(TypeError);
  });

  test('an explicit envelope beats every legacy field and is returned as a fresh structure', () => {
    const explicit = createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'new' });
    const normalized = normalizeTaskEnvelope({
      taskEnvelope: explicit,
      conversationMode: 'code',
      startInNewSession: true,
    });
    expect(normalized).toEqual(explicit);
    expect(normalized).not.toBe(explicit);
    expect(normalized.handoffWorkflow).not.toBe(explicit.handoffWorkflow);
    expect(normalized.conversationMode).toBe('chat');
    expect(normalized.sessionPolicy).toBe('new');
    expect(normalized.handoffWorkflow).toEqual({ preset: 'direct', phase: 'entry' });
    // The fresh copy is itself a valid envelope.
    expect(isTaskEnvelopeV1(normalized)).toBe(true);
  });

  test('unknown or malformed explicit envelope throws TypeError', () => {
    const base = createTaskEnvelope();
    expect(() => normalizeTaskEnvelope({ taskEnvelope: 42 })).toThrow(TypeError);
    expect(() => normalizeTaskEnvelope({ taskEnvelope: 'nope' })).toThrow(TypeError);
    expect(() => normalizeTaskEnvelope({ taskEnvelope: null })).toThrow(TypeError);
    expect(() => normalizeTaskEnvelope({ taskEnvelope: { version: 99 } })).toThrow(TypeError);
    expect(() =>
      normalizeTaskEnvelope({ taskEnvelope: { ...base, conversationMode: 'codex' } })
    ).toThrow(TypeError);
    expect(() =>
      normalizeTaskEnvelope({
        taskEnvelope: { ...base, handoffWorkflow: { preset: 'review', phase: 'entry' } },
      })
    ).toThrow(TypeError);
  });
});

describe('TaskEnvelopeV1 immutable queue transformations', () => {
  test('a mode edit resets preset/phase to the new mode defaults and preserves the session policy', () => {
    const envelope = createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'new' });
    const edited = withTaskEnvelopeConversationMode(envelope, 'code');
    expect(edited.conversationMode).toBe('code');
    expect(edited.sessionPolicy).toBe('new');
    expect(edited.handoffWorkflow).toEqual({ preset: 'team', phase: 'entry' });
  });

  test('a session-policy edit preserves mode and workflow but returns fresh objects', () => {
    const envelope = normalizeTaskEnvelope({ conversationMode: 'chat', startInNewSession: true });
    const edited = withTaskEnvelopeSessionPolicy(envelope, 'continue');
    expect(edited.sessionPolicy).toBe('continue');
    expect(edited.conversationMode).toBe('chat');
    expect(edited.handoffWorkflow).toEqual(envelope.handoffWorkflow);
    expect(edited.handoffWorkflow).not.toBe(envelope.handoffWorkflow);
  });

  test('transformations never mutate the original envelope', () => {
    const envelope = createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' });
    const before = copyEnvelope(envelope);
    withTaskEnvelopeConversationMode(envelope, 'chat');
    withTaskEnvelopeSessionPolicy(envelope, 'continue');
    advanceTaskEnvelopeWorkflow(envelope);
    expect(envelope).toEqual(before);
  });
});

describe('TaskEnvelopeV1 workflow transition matrix', () => {
  test('direct sequence is entry → delivery → delivery', () => {
    let envelope = createTaskEnvelope({ conversationMode: 'chat' });
    expect(envelope.handoffWorkflow.phase).toBe('entry');
    envelope = advanceTaskEnvelopeWorkflow(envelope);
    expect(envelope.handoffWorkflow.phase).toBe('delivery');
    envelope = advanceTaskEnvelopeWorkflow(envelope);
    expect(envelope.handoffWorkflow.phase).toBe('delivery');
  });

  test('team sequence is entry → implementation → delivery', () => {
    let envelope = createTaskEnvelope({ conversationMode: 'code' });
    expect(envelope.handoffWorkflow.phase).toBe('entry');
    envelope = advanceTaskEnvelopeWorkflow(envelope);
    expect(envelope.handoffWorkflow.phase).toBe('implementation');
    envelope = advanceTaskEnvelopeWorkflow(envelope);
    expect(envelope.handoffWorkflow.phase).toBe('delivery');
  });

  test('terminal delivery is idempotent', () => {
    const direct = createTaskEnvelope({ conversationMode: 'chat' });
    const atDelivery = advanceTaskEnvelopeWorkflow(advanceTaskEnvelopeWorkflow(direct));
    expect(atDelivery.handoffWorkflow.phase).toBe('delivery');
    expect(advanceTaskEnvelopeWorkflow(atDelivery)).toEqual(atDelivery);
  });

  test('transitions preserve mode and session policy and return fresh objects', () => {
    const envelope = normalizeTaskEnvelope({ conversationMode: 'chat', startInNewSession: true });
    const before = copyEnvelope(envelope);
    const next = advanceTaskEnvelopeWorkflow(envelope);
    expect(next.conversationMode).toBe('chat');
    expect(next.sessionPolicy).toBe('new');
    expect(next.handoffWorkflow.preset).toBe('direct');
    expect(next.handoffWorkflow.phase).toBe('delivery');
    expect(next).not.toBe(envelope);
    expect(next.handoffWorkflow).not.toBe(envelope.handoffWorkflow);
    expect(envelope).toEqual(before);
  });
});
