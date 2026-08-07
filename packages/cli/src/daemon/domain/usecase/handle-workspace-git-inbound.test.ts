import { describe, expect, test, vi } from 'vitest';

import {
  handleWorkspaceGitInbound,
  type WorkspaceGitInboundEvent,
} from './handle-workspace-git-inbound.js';

describe('handleWorkspaceGitInbound', () => {
  test('invokes deliverInbound when provided', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: WorkspaceGitInboundEvent = {
      type: 'workspace.list-changed',
      machineId: 'machine_1',
    };

    await handleWorkspaceGitInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleWorkspaceGitInbound({}, { type: 'git.request', requestId: 'req_1' })
    ).resolves.toBeUndefined();
  });
});
