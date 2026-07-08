/**
 * useCommandRunner unit tests
 *
 * Covers:
 * - runCommand always dispatches a fresh mutation
 * - runOrAttach focuses an existing active run instead of restarting
 * - activeRunOutput is no longer returned (moved to useCommandRunOutputV2)
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Import after mocks
import { useCommandRunner } from './useCommandRunner';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunCommandMutation = vi.fn().mockResolvedValue('run-id-new');
const mockStopCommandMutation = vi.fn().mockResolvedValue(undefined);
const mockListCommandsQuery = vi.fn().mockReturnValue([]);
const mockListRunsQuery = vi.fn().mockReturnValue([]);

// Mock useSessionMutation and useSessionQuery
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: vi.fn((key: string) => {
    if (key === 'runCommand') return mockRunCommandMutation;
    if (key === 'stopCommand') return mockStopCommandMutation;
    return vi.fn();
  }),
  useSessionQuery: vi.fn((key: string) => {
    if (key === 'listCommands') return mockListCommandsQuery();
    if (key === 'listRunsV2') return mockListRunsQuery();
    return undefined;
  }),
}));

// Mock the api module
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      listCommands: 'listCommands',
      listRunsV2: 'listRunsV2',
      runCommand: 'runCommand',
      stopCommand: 'stopCommand',
    },
  },
}));

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

  describe('runOrAttach', () => {
    it('attaches to an existing active run without dispatching runCommand', async () => {
      mockListRunsQuery.mockReturnValue([
        {
          _id: 'run-id-existing',
          commandName: 'dev',
          script: 'pnpm dev',
          status: 'running',
          startedAt: Date.now(),
        },
      ]);

      const { result } = renderHook(() => useCommandRunner(props));

      let returnedId: string | null = null;
      await act(async () => {
        returnedId = await result.current.runOrAttach('dev', 'pnpm dev');
      });

      expect(mockRunCommandMutation).not.toHaveBeenCalled();
      expect(returnedId).toBe('run-id-existing');
      expect(result.current.activeRunId).toBe('run-id-existing');
    });

    it('starts a new run when no active instance exists', async () => {
      const { result } = renderHook(() => useCommandRunner(props));

      await act(async () => {
        await result.current.runOrAttach('build', 'pnpm build');
      });

      expect(mockRunCommandMutation).toHaveBeenCalledTimes(1);
    });
  });

  describe('return contract', () => {
    it('does not include activeRunOutput (moved to useCommandRunOutputV2)', () => {
      const { result } = renderHook(() => useCommandRunner(props));
      expect(result.current).not.toHaveProperty('activeRunOutput');
    });

    it('includes commands, runs, activeRunId, setActiveRunId, runCommand, runOrAttach, stopCommand', () => {
      const { result } = renderHook(() => useCommandRunner(props));
      expect(result.current).toHaveProperty('commands');
      expect(result.current).toHaveProperty('runs');
      expect(result.current).toHaveProperty('activeRunId');
      expect(result.current).toHaveProperty('setActiveRunId');
      expect(result.current).toHaveProperty('runCommand');
      expect(result.current).toHaveProperty('runOrAttach');
      expect(result.current).toHaveProperty('stopCommand');
    });
  });
});
