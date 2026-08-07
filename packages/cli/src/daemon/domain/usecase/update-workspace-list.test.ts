import { describe, expect, it, vi } from 'vitest';

import { updateWorkspaceList, type UpdateWorkspaceListDeps } from './update-workspace-list.js';

describe('updateWorkspaceList', () => {
  it('dispatches workspace.list-changed events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: UpdateWorkspaceListDeps = { dispatchInbound };
    const event = { type: 'workspace.list-changed' as const, machineId: 'machine_1' };

    await updateWorkspaceList(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
