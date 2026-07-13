import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeLocalAction } from './execute-local-action.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

function mockSpawnChild(exitCode = 0) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const child = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
      if (event === 'close') {
        queueMicrotask(() => handler(exitCode));
      }
      return child;
    }),
    unref: vi.fn(),
  };
  vi.mocked(spawn).mockReturnValue(child as never);
  return { child, handlers };
}

describe('executeLocalAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(access).mockResolvedValue(undefined);
  });

  it('spawns detached shell commands with ignored stdio for open-finder', async () => {
    mockSpawnChild();

    const result = await executeLocalAction('open-finder', '/tmp/workspace');

    expect(result).toEqual({ success: true });
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('open'),
      [],
      expect.objectContaining({ stdio: 'ignore', detached: true, shell: true })
    );
  });

  it('checks CLI availability with detached spawn before open-vscode', async () => {
    mockSpawnChild(0);
    const secondChild = mockSpawnChild();

    const result = await executeLocalAction('open-vscode', '/tmp/workspace');

    expect(result).toEqual({ success: true });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(secondChild.child.unref).toHaveBeenCalled();
  });

  it('returns error when vscode CLI is unavailable', async () => {
    mockSpawnChild(1);

    const result = await executeLocalAction('open-vscode', '/tmp/workspace');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('VS Code CLI');
    }
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
