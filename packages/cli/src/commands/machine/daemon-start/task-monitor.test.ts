import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import {
  parseSessionAugmentation,
  resolveSessionAugmentationForRole,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import { isNativeHarness } from './native-task-injector-logic.js';
import { NudgeCooldown, listTasksReadyForNudge } from './task-monitor-logic.js';

function expectPendingNudge(task: AssignedTaskView, now: number, shouldNudge: boolean): void {
  const cooldown = new NudgeCooldown(60_000);
  const ready = listTasksReadyForNudge([task], now, cooldown);
  expect(ready.length > 0).toBe(shouldNudge);
}

function makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'builder',
    taskContent: '',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'opencode',
      workingDir: '/tmp/project',
      spawnedAgentPid: 12345,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'get-next-task:started',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

describe('shouldNudgePendingTask', () => {
  test('nudges when agent claims listening but task arrived after lastSeenAt', () => {
    expectPendingNudge(makeTask(), 10_000, true);
  });

  test('does not nudge when task predates lastSeenAt', () => {
    expectPendingNudge(
      makeTask({
        createdAt: 400,
        participant: {
          lastSeenAction: 'get-next-task:started',
          lastSeenAt: 500,
          lastStatus: 'agent.waiting',
        },
      }),
      10_000,
      false
    );
  });

  test('nudges when agent is idle after delivery and task is pending >15s', () => {
    const createdAt = 1_000;
    const now = createdAt + 15_000 + 1;
    expectPendingNudge(
      makeTask({
        createdAt,
        participant: {
          lastSeenAction: 'get-next-task:stopped',
          lastSeenAt: createdAt - 100,
          lastStatus: 'task.acknowledged',
        },
      }),
      now,
      true
    );
  });

  test('does not nudge non-pending tasks', () => {
    expectPendingNudge(makeTask({ status: 'in_progress' }), 10_000, false);
  });

  test('does not nudge when agent process is not alive', () => {
    expectPendingNudge(
      makeTask({
        agentConfig: {
          ...makeTask().agentConfig,
          spawnedAgentPid: undefined,
        },
      }),
      10_000,
      false
    );
  });
});

describe('nudge wantResume from task content', () => {
  function resolveWantResume(taskContent: string, role = 'builder'): boolean {
    return sessionAugmentationToWantResume(resolveSessionAugmentationForRole(taskContent, role));
  }

  test('new_session → wantResume false (cold spawn)', () => {
    const content = `## Session Augmentation
// data:agent.session_augmentation=new_session`;
    expect(resolveWantResume(content)).toBe(false);
  });

  test('legacy reset → wantResume false (cold spawn)', () => {
    const content = `## Restart new context
// data:agent.compress_context=reset`;
    expect(resolveWantResume(content)).toBe(false);
  });

  test('none → wantResume true (resume session)', () => {
    const content = `## Session Augmentation
// data:agent.session_augmentation=none`;
    expect(resolveWantResume(content)).toBe(true);
  });

  test('compact → wantResume true (no cold restart)', () => {
    const content = `## Session Augmentation
// data:agent.session_augmentation=compact`;
    expect(resolveWantResume(content)).toBe(true);
  });

  test('missing section → wantResume false for builder (default new_session)', () => {
    expect(resolveWantResume('## Goal\nImplement feature')).toBe(false);
  });

  test('planner missing section → wantResume true (augmentation gated to none)', () => {
    expect(resolveWantResume('## Goal\nAck user task', 'planner')).toBe(true);
  });

  test('regression: planner builder handback → wantResume true (must not cold-restart)', () => {
    const handback = `## Summary
Implemented feature.

## Changes Made
- Done`;
    expect(resolveWantResume(handback, 'planner')).toBe(true);
  });

  test('regression: planner must not get wantResume=false from missing section default', () => {
    const userTask = `## Goal
Acknowledge user message`;
    expect(parseSessionAugmentation(userTask)).toBe('new_session');
    expect(resolveWantResume(userTask, 'planner')).toBe(true);
  });
});

describe('NudgeCooldown', () => {
  test('deduplicates nudges within cooldown window', () => {
    const cooldown = new NudgeCooldown(60_000);
    const now = 1_000_000;

    expect(cooldown.canNudge('room', 'builder', now)).toBe(true);
    cooldown.recordNudge('room', 'builder', now);
    expect(cooldown.canNudge('room', 'builder', now + 30_000)).toBe(false);
    expect(cooldown.canNudge('room', 'builder', now + 60_000)).toBe(true);
  });
});

describe('native harness nudge exclusion', () => {
  test('native harness is not nudged when injection appears stuck', () => {
    const createdAt = 1_000;
    const now = createdAt + 15_001;
    const nativeTask = makeTask({
      agentConfig: {
        ...makeTask().agentConfig,
        agentHarness: 'cursor-sdk',
      },
      createdAt,
      participant: {
        lastSeenAction: NATIVE_WAITING_ACTION,
        lastSeenAt: createdAt,
        lastStatus: 'agent.waiting',
      },
    });
    expect(isNativeHarness(nativeTask.agentConfig.agentHarness)).toBe(true);
    expectPendingNudge(nativeTask, now, false);
  });

  test('CLI harness still uses get-next-task stale waiting logic (regression)', () => {
    const now = 10_000;
    const cliTask = makeTask({
      agentConfig: {
        ...makeTask().agentConfig,
        agentHarness: 'opencode',
      },
    });
    expectPendingNudge(cliTask, now, true);
  });

  test('CLI new_session still implies wantResume false (regression)', () => {
    const content = `## Session Augmentation
// data:agent.session_augmentation=new_session`;
    expect(
      sessionAugmentationToWantResume(resolveSessionAugmentationForRole(content, 'builder'))
    ).toBe(false);
  });
});

describe('listTasksReadyForNudge', () => {
  test('excludes native harness even without workingDir', () => {
    const createdAt = 1_000;
    const now = createdAt + 15_001;
    const nativeTask = makeTask({
      agentConfig: {
        ...makeTask().agentConfig,
        agentHarness: 'cursor-sdk',
        workingDir: undefined,
      },
      createdAt,
      participant: {
        lastSeenAction: NATIVE_WAITING_ACTION,
        lastSeenAt: createdAt,
        lastStatus: 'agent.waiting',
      },
    });
    const cooldown = new NudgeCooldown(60_000);
    expect(listTasksReadyForNudge([nativeTask], now, cooldown)).toHaveLength(0);
  });

  test('still excludes CLI harness without workingDir', () => {
    const now = 10_000;
    const cliTask = makeTask({
      agentConfig: {
        ...makeTask().agentConfig,
        agentHarness: 'opencode',
        workingDir: undefined,
      },
    });
    const cooldown = new NudgeCooldown(60_000);
    expect(listTasksReadyForNudge([cliTask], now, cooldown)).toHaveLength(0);
  });
});
