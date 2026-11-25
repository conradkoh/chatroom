import { describe, expect, it } from 'vitest';

import {
  ChatroomActivityStatusEnum,
  ChatroomStateEnum,
  deriveChatroomActivityStatus,
  deriveChatroomState,
  hasStuckAssignedWork,
  isChatroomStopAvailable,
  type ChatroomAssignedActiveTask,
  type ChatroomRoleActivityStatus,
} from './chatroom-activity-status';

const task = (
  assignedTo: string,
  status: ChatroomAssignedActiveTask['status']
): ChatroomAssignedActiveTask => ({ assignedTo, status });

const row = (
  role: string,
  status: ChatroomRoleActivityStatus['status']
): ChatroomRoleActivityStatus => ({ role, status });

describe('chatroom activity status', () => {
  it('derives the allowed high-level states from role read-model statuses', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'waiting' }])).toBe(
      ChatroomActivityStatusEnum.active
    );
    expect(deriveChatroomActivityStatus('active', [{ status: 'starting' }])).toBe(
      ChatroomActivityStatusEnum.transitioning
    );
    expect(deriveChatroomActivityStatus('active', [])).toBe(ChatroomActivityStatusEnum.idle);
    expect(deriveChatroomActivityStatus('completed', [{ status: 'working' }])).toBe(
      ChatroomActivityStatusEnum.completed
    );
  });

  it('uses the same projected states for stop eligibility', () => {
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.active)).toBe(true);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.transitioning)).toBe(true);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.idle)).toBe(false);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.completed)).toBe(false);
  });

  it('collapses detailed activity into strict chatroom states', () => {
    expect(deriveChatroomState(ChatroomActivityStatusEnum.working)).toBe(ChatroomStateEnum.active);
    expect(deriveChatroomState(ChatroomActivityStatusEnum.transitioning)).toBe(
      ChatroomStateEnum.attention
    );
    expect(deriveChatroomState(ChatroomActivityStatusEnum.idle)).toBe(ChatroomStateEnum.offline);
  });
});

describe('stuck derivation precedence', () => {
  it('lets stuck win over working activity', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'working' }], true)).toBe('stuck');
  });

  it('lets stuck win over waiting activity', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'waiting' }], true)).toBe('stuck');
  });

  it('lets stuck win over transitioning activity', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'starting' }], true)).toBe('stuck');
  });

  it('keeps completed ahead of stuck', () => {
    expect(deriveChatroomActivityStatus('completed', [], true)).toBe('completed');
  });

  it('keeps the previous results when no stuck work is reported', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'working' }])).toBe('working');
  });

  it('maps stuck to attention and keeps it stop-available', () => {
    expect(deriveChatroomState('stuck')).toBe(ChatroomStateEnum.attention);
    expect(isChatroomStopAvailable('stuck')).toBe(true);
  });
});

describe('hasStuckAssignedWork', () => {
  it.each([
    [
      'persistent offline + in_progress',
      [row('builder', 'offline')],
      [task('builder', 'in_progress')],
    ],
    ['persistent offline + pending', [row('builder', 'offline')], [task('builder', 'pending')]],
    ['persistent error + pending', [row('builder', 'error')], [task('builder', 'pending')]],
    ['persistent with no row', [row('planner', 'waiting')], [task('builder', 'in_progress')]],
    [
      'mixed-case assignee against lowercase row',
      [row('builder', 'offline')],
      [task('Builder', 'in_progress')],
    ],
    [
      'ephemeral offline + in_progress',
      [row('architect', 'offline')],
      [task('architect', 'in_progress')],
    ],
    ['ephemeral error + pending', [row('architect', 'error')], [task('architect', 'pending')]],
    [
      'ephemeral offline + acknowledged',
      [row('architect', 'offline')],
      [task('architect', 'acknowledged')],
    ],
    [
      'two tasks, one stuck',
      [row('builder', 'working'), row('architect', 'offline')],
      [task('builder', 'in_progress'), task('architect', 'in_progress')],
    ],
  ])('is stuck for %s', (_name, rows, tasks) => {
    expect(hasStuckAssignedWork(rows, tasks)).toBe(true);
  });

  it.each([
    [
      'persistent starting + in_progress',
      [row('builder', 'starting')],
      [task('builder', 'in_progress')],
    ],
    [
      'persistent stopping + in_progress',
      [row('builder', 'stopping')],
      [task('builder', 'in_progress')],
    ],
    [
      'persistent waiting + in_progress',
      [row('builder', 'waiting')],
      [task('builder', 'in_progress')],
    ],
    [
      'persistent working + in_progress',
      [row('builder', 'working')],
      [task('builder', 'in_progress')],
    ],
    [
      'ephemeral offline + pending (on-demand start)',
      [row('architect', 'offline')],
      [task('architect', 'pending')],
    ],
    ['ephemeral missing row + pending', [], [task('architect', 'pending')]],
    ['assignee user', [], [task('user', 'in_progress')]],
    ['empty assignee', [], [task('', 'pending')]],
    ['no tasks', [row('builder', 'offline')], []],
    [
      'role with two rows, one online',
      [row('builder', 'offline'), row('builder', 'working')],
      [task('builder', 'in_progress')],
    ],
  ])('is not stuck for %s', (_name, rows, tasks) => {
    expect(hasStuckAssignedWork(rows, tasks)).toBe(false);
  });
});
