import { describe, expect, test, vi } from 'vitest';
import type { AssignedTaskPresenceSignal, AssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  handleAssignedTaskInbound,
  type AssignedTaskInboundEvent,
} from './handle-assigned-task-inbound.js';

describe('handleAssignedTaskInbound', () => {
  test('invokes deliverInbound when provided', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      signal: {} as AssignedTaskSignal,
    };

    await handleAssignedTaskInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleAssignedTaskInbound(
        {},
        { type: 'assigned-task.presence', presence: {} as AssignedTaskPresenceSignal }
      )
    ).resolves.toBeUndefined();
  });
});
