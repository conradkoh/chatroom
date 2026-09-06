import { describe, expect, test } from 'vitest';

import { inferPrimaryHandoffTarget } from './infer-primary-handoff-target';

describe('inferPrimaryHandoffTarget', () => {
  test('builder returns work to planner', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: ['planner'],
      })
    ).toBe('planner');
  });

  test('entry point planner receiving planning feedback from enhancer targets builder', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'enhancer',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('builder');
  });

  test('entry point planner receiving user message targets enhancer when enabled', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
      })
    ).toBe('enhancer');
  });

  test('solo entry point receiving user message targets enhancer when enabled', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'solo',
        availableHandoffTargets: ['enhancer', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
      })
    ).toBe('enhancer');
  });

  test('solo entry point receiving enhancer input targets user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'enhancer',
        role: 'solo',
        availableHandoffTargets: ['user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
      })
    ).toBe('user');
  });

  test('entry point planner receiving user message targets user when enhancer disabled', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('entry point planner receiving builder handback delivers to user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'builder',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('entry point planner receiving builder handback delivers to user when enhancer enabled', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'builder',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
      })
    ).toBe('user');
  });

  test('non-entry-point does not redirect team sender to user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: ['planner', 'user'],
        isEntryPoint: false,
      })
    ).toBe('planner');
  });
});

describe('inferPrimaryHandoffTarget — conversationMode', () => {
  test('explicit chat + entry point + user task targets user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        conversationMode: 'chat',
      })
    ).toBe('user');
  });

  test('explicit chat recommendation is independent of advertised builder capability', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
        conversationMode: 'chat',
      })
    ).toBe('user');
  });

  test('explicit code + entry point + user task targets user (no enhancer)', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        conversationMode: 'code',
      })
    ).toBe('user');
  });

  test('explicit code:enhanced + entry point + user task targets enhancer', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        conversationMode: 'code:enhanced',
      })
    ).toBe('enhancer');
  });

  test('explicit chat overrides legacy plannerEnhancerEnabled: true', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
        conversationMode: 'chat',
      })
    ).toBe('user');
  });

  test('omitted mode + plannerEnhancerEnabled: true targets enhancer (legacy)', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['enhancer', 'builder', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: true,
      })
    ).toBe('enhancer');
  });

  test('omitted mode + plannerEnhancerEnabled: false targets user (legacy)', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
        plannerEnhancerEnabled: false,
      })
    ).toBe('user');
  });
});
