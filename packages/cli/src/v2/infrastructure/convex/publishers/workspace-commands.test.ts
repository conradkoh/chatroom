import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceCommandsPublisher } from './workspace-commands.js';

describe('createWorkspaceCommandsPublisher', () => {
  it('calls syncCommands with workspace commands', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createWorkspaceCommandsPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    const commands = [{ name: 'build', command: 'pnpm build' }];
    await publisher.publish({
      type: 'workspace.commands',
      workingDir: '/repo',
      commands,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      workingDir: '/repo',
      commands,
    });
  });
});
