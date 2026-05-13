/**
 * useCommandRunner unit tests
 *
 * Covers:
 * - runCommand always dispatches a fresh mutation (no "focus existing" branch)
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunCommandMutation = vi.fn().mockResolvedValue('run-id-new');
const mockStopCommandMutation = vi.fn().mockResolvedValue(undefined);
const mockListCommandsQuery = vi.fn().mockReturnValue([]);
const mockListRunsQuery = vi.fn().mockReturnValue([]);
const mockGetRunOutputQuery = vi.fn().mockReturnValue({ chunks: [], run: null });

// Mock useSessionMutation and useSessionQuery
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: vi.fn((key: string) => {
    if (key === 'runCommand') return mockRunCommandMutation;
    if (key === 'stopCommand') return mockStopCommandMutation;
    return vi.fn();
  }),
  useSessionQuery: vi.fn((key: string) => {
    if (key === 'listCommands') return mockListCommandsQuery();
    if (key === 'listRuns') return mockListRunsQuery();
    if (key === 'getRunOutput') return mockGetRunOutputQuery();
    return undefined;
  }),
}));

// Mock the api module
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      listCommands: 'listCommands',
      listRuns: 'listRuns',
      getRunOutput: 'getRunOutput',
      runCommand: 'runCommand',
      stopCommand: 'stopCommand',
    },
  },
}));

// Import after mocks
import { useCommandRunner } from './useCommandRunner';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useCommandRunner', () => {
  const props = {
    machineId: 'test-machine',
    workingDir: '/test/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommandMutation.mockResolvedValue('run-id-new');
    mockListRunsQuery.mockReturnValue([]);
    mockGetRunOutputQuery.mockReturnValue({ chunks: [], run: null });
  });

  describe('runCommand', () => {
    it('always dispatches a fresh runCommand mutation (no focus-existing branch)', async () => {
      // Set up a currently "running" entry in the runs list
      mockListRunsQuery.mockReturnValue([
        {
          _id: 'run-id-existing',
          commandName: 'dev',
          script: 'pnpm dev',
          status: 'running',
          startedAt: Date.now(),
          requestedBy: 'user-1',
        },
      ]);

      const { result } = renderHook(() => useCommandRunner(props));

      let returnedId: string | null = null;
      await act(async () => {
        returnedId = await result.current.runCommand('dev', 'pnpm dev');
      });

      // Mutation should have been called — NOT the "focus existing" shortcut
      expect(mockRunCommandMutation).toHaveBeenCalledTimes(1);
      expect(mockRunCommandMutation).toHaveBeenCalledWith({
        machineId: 'test-machine',
        workingDir: '/test/project',
        commandName: 'dev',
        script: 'pnpm dev',
      });
      // activeRunId set to the new run (not the existing one)
      expect(returnedId).toBe('run-id-new');
    });

    it('dispatches mutation when no existing run found', async () => {
      const { result } = renderHook(() => useCommandRunner(props));

      await act(async () => {
        await result.current.runCommand('build', 'pnpm build');
      });

      expect(mockRunCommandMutation).toHaveBeenCalledTimes(1);
    });

    it('returns null when machineId is null', async () => {
      const { result } = renderHook(() =>
        useCommandRunner({ machineId: null, workingDir: '/tmp' })
      );

      let returnedId: string | null | undefined = undefined;
      await act(async () => {
        returnedId = await result.current.runCommand('dev', 'pnpm dev');
      });

      expect(returnedId).toBeNull();
      expect(mockRunCommandMutation).not.toHaveBeenCalled();
    });
  });
});
