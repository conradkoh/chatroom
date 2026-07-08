import { describe, expect, it } from 'vitest';

import { assertRegisteredWorkingDir } from './assert-registered-working-dir.js';
import { createMockDaemonDeps } from '../../../commands/machine/daemon-start/testing/mock-daemon-deps.js';

describe('assertRegisteredWorkingDir', () => {
  it('matches workspace when request path differs only by trailing slash', async () => {
    const deps = createMockDaemonDeps();
    const session = {
      sessionId: 'session-1' as const,
      machineId: 'machine-1',
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    };

    const result = await assertRegisteredWorkingDir(session, '/Users/alice/chatroom/');

    expect(result).toEqual({ ok: true });
  });

  it('rejects when workspace is not registered', async () => {
    const deps = createMockDaemonDeps();
    const session = {
      sessionId: 'session-1' as const,
      machineId: 'machine-1',
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    };

    const result = await assertRegisteredWorkingDir(session, '/Users/alice/other');

    expect(result).toEqual({ ok: false, error: 'Workspace not registered for this machine' });
  });
});
