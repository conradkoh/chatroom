import { describe, expect, it } from 'vitest';

import { assertRegisteredWorkingDir } from './assert-registered-working-dir.js';
import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';
import { createMockDaemonSessionInit } from '../../../commands/machine/daemon-start/testing/index.js';
import { createMockDaemonDeps } from '../../../commands/machine/daemon-start/testing/mock-daemon-deps.js';

describe('assertRegisteredWorkingDir', () => {
  it('matches workspace when request path differs only by trailing slash', async () => {
    const deps = createMockDaemonDeps();
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/chatroom/'
    );

    expect(result).toEqual({ ok: true });
  });

  it('rejects when workspace is not registered', async () => {
    const deps = createMockDaemonDeps();
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/other'
    );

    expect(result).toEqual({ ok: false, error: 'Workspace not registered for this machine' });
  });
});
