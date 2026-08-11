import { describe, expect, test } from 'vitest';

import {
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from './parse-session-augmentation';

describe('resolveSessionAugmentationForRole', () => {
  test('builder always returns new_session regardless of body content', () => {
    expect(resolveSessionAugmentationForRole('## Goal\nDo work', 'builder')).toBe('new_session');
    expect(
      resolveSessionAugmentationForRole(
        '## Session Augmentation\n// data:agent.session_augmentation=none',
        'builder'
      )
    ).toBe('new_session');
  });

  test('planner always returns new_session', () => {
    expect(resolveSessionAugmentationForRole('## Goal\nDo work', 'planner')).toBe('new_session');
    expect(
      resolveSessionAugmentationForRole(
        '## Session Augmentation\n// data:agent.session_augmentation=new_session',
        'planner'
      )
    ).toBe('new_session');
  });

  test('other non-augmentable roles return none', () => {
    for (const role of ['architect', 'solo', 'reviewer']) {
      expect(resolveSessionAugmentationForRole('## Goal\nDo work', role)).toBe('none');
    }
  });
});

describe('sessionAugmentationToWantResume', () => {
  test('none → resume prior session', () => {
    expect(sessionAugmentationToWantResume('none')).toBe(true);
  });

  test('new_session → cold spawn', () => {
    expect(sessionAugmentationToWantResume('new_session')).toBe(false);
  });
});

describe('sessionAugmentationNewSessionStarted', () => {
  test('only new_session starts a new session', () => {
    expect(sessionAugmentationNewSessionStarted('new_session')).toBe(true);
    expect(sessionAugmentationNewSessionStarted('none')).toBe(false);
  });
});
