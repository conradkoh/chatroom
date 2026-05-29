/**
 * useInlineCommandOutput unit tests
 *
 * Covers:
 * - detach() clears UI state WITHOUT calling stopCommand
 * - stop() calls stopCommand
 * - close() calls stopCommand AND clears state
 * - getRunOutput subscription is skipped when no modal is visible
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { useCommandRunner } from './useCommandRunner';
import { useInlineCommandOutput } from './useInlineCommandOutput';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}));

vi.mock('./useActiveRunOutput', () => ({
  useActiveRunOutput: vi.fn((activeRunId: string | null) => {
    if (!activeRunId) {
      return { chunks: [], run: null, canLoadMore: false, fullOutputPending: false };
    }
    return {
      chunks: [{ content: 'hello', chunkIndex: 0, timestamp: 0 }],
      run: {
        _id: activeRunId,
        commandName: 'test',
        status: 'running',
        script: 'pnpm test',
      },
      canLoadMore: true,
      fullOutputPending: false,
    };
  }),
}));

import { useActiveRunOutput } from './useActiveRunOutput';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CommandRunner = ReturnType<typeof useCommandRunner>;

function createMockCommandRunner(
  overrides: Partial<CommandRunner> = {}
): CommandRunner {
  return {
    commands: [],
    runs: [],
    activeRunId: null,
    setActiveRunId: vi.fn(),
    runCommand: vi.fn().mockResolvedValue('run-id-1'),
    stopCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useInlineCommandOutput', () => {
  let mockRunner: CommandRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunner = createMockCommandRunner({
      activeRunId: 'run-id-123',
    });
  });

  describe('attach()', () => {
    it('sets commandName, script, and activeRunId WITHOUT calling stopCommand', () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      act(() => {
        result.current.attach('run-id-existing', 'dev', 'pnpm dev');
      });

      expect(result.current.commandName).toBe('dev');
      expect(result.current.script).toBe('pnpm dev');
      expect(mockRunner.setActiveRunId).toHaveBeenCalledWith('run-id-existing');
      expect(mockRunner.stopCommand).not.toHaveBeenCalled();
    });
  });

  describe('detach()', () => {
    it('clears commandName and script without calling stopCommand', async () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      // Set up UI state
      await act(async () => {
        result.current.run('dev', 'pnpm dev');
      });
      expect(result.current.commandName).toBe('dev');
      expect(result.current.script).toBe('pnpm dev');

      // Detach — should clear UI without killing process
      act(() => {
        result.current.detach();
      });

      expect(result.current.commandName).toBeNull();
      expect(result.current.script).toBeNull();
      expect(mockRunner.stopCommand).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('calls stopCommand with activeRunId', () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      act(() => {
        result.current.stop();
      });

      expect(mockRunner.stopCommand).toHaveBeenCalledWith('run-id-123');
    });

    it('is a no-op when activeRunId is null', () => {
      const runnerNoRun = createMockCommandRunner({ activeRunId: null });
      const { result } = renderHook(() => useInlineCommandOutput(runnerNoRun));

      act(() => {
        result.current.stop();
      });

      expect(runnerNoRun.stopCommand).not.toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('calls stopCommand AND clears state', async () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      await act(async () => {
        result.current.run('build', 'pnpm build');
      });
      expect(result.current.commandName).toBe('build');

      act(() => {
        result.current.close();
      });

      expect(mockRunner.stopCommand).toHaveBeenCalledWith('run-id-123');
      expect(result.current.commandName).toBeNull();
      expect(result.current.script).toBeNull();
    });
  });

  describe('demand-driven subscription', () => {
    it('skips useActiveRunOutput when no modal is visible (commandName null)', () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      // No modal visible initially
      expect(result.current.commandName).toBeNull();
      expect(useActiveRunOutput).toHaveBeenLastCalledWith(null, { loadFull: false });
    });

    it('subscribes to useActiveRunOutput when modal is visible', async () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      await act(async () => {
        result.current.run('dev', 'pnpm dev');
      });

      expect(result.current.commandName).toBe('dev');
      // After run(), commandName is non-null so the hook passes
      // commandRunner.activeRunId (which is 'run-id-123') to useActiveRunOutput
      expect(useActiveRunOutput).toHaveBeenLastCalledWith('run-id-123', { loadFull: false });
    });

    it('unsubscribes when modal is detached', async () => {
      const { result } = renderHook(() => useInlineCommandOutput(mockRunner));

      await act(async () => {
        result.current.run('dev', 'pnpm dev');
      });

      act(() => {
        result.current.detach();
      });

      expect(result.current.commandName).toBeNull();
      expect(useActiveRunOutput).toHaveBeenLastCalledWith(null, { loadFull: false });
    });
  });
});
