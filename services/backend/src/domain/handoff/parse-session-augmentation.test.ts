import { describe, expect, test } from 'vitest';

import {
  resolveSessionAugmentationForTask,
  shouldEmitSessionAugmentation,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from './parse-session-augmentation';

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
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
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
