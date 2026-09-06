import {
  createTaskEnvelope,
  advanceTaskEnvelopeWorkflow,
  type TaskEnvelopeV1,
} from '@workspace/shared/domain/task-envelope';
import { describe, expect, test } from 'vitest';

import {
  resolveSessionAugmentationForTask,
  shouldEmitSessionAugmentation,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
  taskRequestsNativeColdSession,
} from './parse-session-augmentation';

const NEW_ENVELOPE: TaskEnvelopeV1 = createTaskEnvelope({
  conversationMode: 'code',
  sessionPolicy: 'new',
});
const CONTINUE_ENVELOPE: TaskEnvelopeV1 = createTaskEnvelope({
  conversationMode: 'chat',
  sessionPolicy: 'continue',
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
    expect(
      resolveSessionAugmentationForTask(
        { content: '## Goal\nDo work', startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
  });

  test('explicit envelope new plus stale scalar false resolves to new_session', () => {
    expect(
      resolveSessionAugmentationForTask(
        {
          content: '## Goal\nDo work',
          taskEnvelope: NEW_ENVELOPE,
          startInNewSession: false,
        },
        'planner'
      )
    ).toBe('new_session');
  });

  test('explicit envelope continue plus stale scalar true resolves to none', () => {
    expect(
      resolveSessionAugmentationForTask(
        {
          content: '## Goal\nDo work',
          taskEnvelope: CONTINUE_ENVELOPE,
          startInNewSession: true,
        },
        'builder'
      )
    ).toBe('none');
  });
});

describe('taskRequestsNativeColdSession', () => {
  test('absent envelope preserves legacy scalar behavior', () => {
    expect(
      taskRequestsNativeColdSession({ content: '## Goal\nDo work', startInNewSession: true })
    ).toBe(true);
    expect(
      taskRequestsNativeColdSession({ content: '## Goal\nDo work', startInNewSession: false })
    ).toBe(false);
    expect(
      taskRequestsNativeColdSession({ content: '## Goal\nDo work', startInNewSession: undefined })
    ).toBe(false);
  });

  test('explicit envelope new plus stale scalar false requests a cold session', () => {
    expect(
      taskRequestsNativeColdSession({
        content: '## Goal\nDo work',
        taskEnvelope: NEW_ENVELOPE,
        startInNewSession: false,
      })
    ).toBe(true);
  });

  test('explicit envelope continue plus stale scalar true does not request a cold session', () => {
    expect(
      taskRequestsNativeColdSession({
        content: '## Goal\nDo work',
        taskEnvelope: CONTINUE_ENVELOPE,
        startInNewSession: true,
      })
    ).toBe(false);
  });

  test('advanced non-entry workflow envelope still honors the session policy', () => {
    const advanced = advanceTaskEnvelopeWorkflow(NEW_ENVELOPE);
    expect(advanced.handoffWorkflow.phase).not.toBe('entry');
    expect(advanced.sessionPolicy).toBe('new');
    expect(
      taskRequestsNativeColdSession({
        content: '## Goal\nDo work',
        taskEnvelope: advanced,
        startInNewSession: undefined,
      })
    ).toBe(true);
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
