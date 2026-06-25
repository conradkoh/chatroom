import { describe, expect, test } from 'vitest';

import {
  clearNativeInjectionDedupForAgent,
  getNativeInjectionDedup,
  markNativeTaskInjected,
} from './native-injection-dedup-registry.js';

describe('native-injection-dedup-registry', () => {
  test('clearNativeInjectionDedupForAgent clears only matching injected tasks', () => {
    const dedup = getNativeInjectionDedup();
    markNativeTaskInjected(dedup, 'task_a', { chatroomId: 'room_1', role: 'planner' });
    markNativeTaskInjected(dedup, 'task_b', { chatroomId: 'room_1', role: 'builder' });

    clearNativeInjectionDedupForAgent('room_1', 'planner');

    expect(dedup.has('task_a')).toBe(false);
    expect(dedup.has('task_b')).toBe(true);
  });
});
