import { describe, expect, it, vi } from 'vitest';

import { assertRegisteredWorkingDir } from './assert-registered-working-dir.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';
import { createFakeWorkspaceService } from '../../../daemon/entry/testing/index.js';

/** Builds the only session field the check reads. */
function sessionWith(isRegistered: (workingDir: string) => boolean) {
  const workspaceService = createFakeWorkspaceService({
    isRegistered: vi.fn(isRegistered),
  });
  return {
    session: { workspaceService } as unknown as Pick<DaemonSessionServiceShape, 'workspaceService'>,
    workspaceService,
  };
}

describe('assertRegisteredWorkingDir', () => {
  it('accepts an active workspace when the request path differs only by trailing slash', async () => {
    const { session, workspaceService } = sessionWith((dir) => dir === '/Users/alice/chatroom');

    const result = await assertRegisteredWorkingDir(session, '/Users/alice/chatroom/');

    expect(result).toEqual({ ok: true });
    expect(workspaceService.isRegistered).toHaveBeenCalledWith('/Users/alice/chatroom');
  });

  it('rejects a directory that is not an active workspace', async () => {
    const { session } = sessionWith(() => false);

    const result = await assertRegisteredWorkingDir(session, '/Users/alice/other');

    expect(result).toEqual({ ok: false, error: 'Workspace not registered for this machine' });
  });

  it('decides from the workspace service alone, without a backend query', async () => {
    const { session, workspaceService } = sessionWith(() => true);

    await assertRegisteredWorkingDir(session, '/Users/alice/chatroom');

    expect(workspaceService.isRegistered).toHaveBeenCalledTimes(1);
  });
});
