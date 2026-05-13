/**
 * useInlineCommandOutput unit tests
 *
 * Covers:
 * - detach() clears UI state WITHOUT calling stopCommand
 * - stop() calls stopCommand
 * - close() calls stopCommand AND clears state
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useInlineCommandOutput } from './useInlineCommandOutput';
import type { useCommandRunner } from './useCommandRunner';

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
    activeRunOutput: { chunks: [], run: null },
    runCommand: vi.fn().mockResolvedValue('run-id-1'),
    stopCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useInlineCommandOutput', () => {
  let mockRunner: CommandRunner;

  beforeEach(() => {
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
});
