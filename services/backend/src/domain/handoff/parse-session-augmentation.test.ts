import { describe, expect, test } from 'vitest';

import {
  resolveSessionAugmentationForRole,
  resolveSessionAugmentationForTask,
  shouldEmitSessionAugmentation,
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

  test('planner always returns none', () => {
    expect(resolveSessionAugmentationForRole('## Goal\nDo work', 'planner')).toBe('none');
    expect(
      resolveSessionAugmentationForRole(
        '## Session Augmentation\n// data:agent.session_augmentation=new_session',
        'planner'
      )
    ).toBe('none');
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

describe('resolveSessionAugmentationForTask', () => {
  test('explicit true overrides planner to new_session', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: true },
        'planner'
      )
    ).toBe('new_session');
  });

  test('explicit false overrides builder to none', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: false },
        'builder'
      )
    ).toBe('none');
  });

  test('undefined preserves role defaults', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: undefined },
        'builder'
      )
    ).toBe('new_session');
  });

  test('after startInNewSession is consumed, planner falls back to none', () => {
    expect(resolveSessionAugmentationForTask({ content: '## Goal\nDo work', startInNewSession: undefined }, 'planner')).toBe('none');
  });
});

describe('shouldEmitSessionAugmentation', () => {
  test('emits new sessions for planner overrides', () => {
    expect(shouldEmitSessionAugmentation('planner', 'new_session')).toBe(true);
  });

  test('does not emit none for planner', () => {
    expect(shouldEmitSessionAugmentation('planner', 'none')).toBe(false);
  });
});

describe('sessionAugmentationNewSessionStarted', () => {
  test('only new_session starts a new session', () => {
    expect(sessionAugmentationNewSessionStarted('new_session')).toBe(true);
    expect(sessionAugmentationNewSessionStarted('none')).toBe(false);
  });
});
