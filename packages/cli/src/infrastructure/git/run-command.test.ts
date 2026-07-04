import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit } from './run-command.js';

const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

function mockSpawnSuccess(stdout: string, stderr = '') {
  mockSpawn.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', 0);
    });
    return child;
  });
}

describe('runGit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes file paths as argv elements without shell interpolation', async () => {
    mockSpawnSuccess('');
    const filePath = 'src/foo;rm -rf /';

    await runGit(['checkout', '--', filePath], '/repo');

    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '--', filePath],
      expect.objectContaining({ cwd: '/repo' })
    );
  });
});
