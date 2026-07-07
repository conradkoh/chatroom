/**
 * useCommandRunOutputV2 unit tests
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { useCommandRunner } from './useCommandRunner';
import { useCommandRunOutputV2 } from './useCommandRunOutputV2';

const mockControlOutput = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(),
  useSessionMutation: vi.fn(() => mockControlOutput),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      getRunOutputV2: 'getRunOutputV2',
      controlRunOutputV2: 'controlRunOutputV2',
    },
  },
}));

vi.mock('@workspace/backend/src/output-encoding-browser', () => ({
  decodeOutputBrowser: vi.fn(async (value: any) => {
    if (typeof value === 'string') return value;
    return `decoded:${value.content}`;
  }),
}));

const mockUseSessionQuery = useSessionQuery as ReturnType<typeof vi.fn>;

type CommandRunner = ReturnType<typeof useCommandRunner>;

function createMockCommandRunner(overrides: Partial<CommandRunner> = {}): CommandRunner {
  const runCommand = vi.fn().mockResolvedValue('run-id-1');
  return {
    commands: [],
    runs: [],
    activeRunId: null,
    setActiveRunId: vi.fn(),
    runCommand,
    runOrAttach: vi
      .fn()
      .mockImplementation((name: string, script: string) => runCommand(name, script)),
    stopCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const encodedHello = {
  compression: 'gzip' as const,
  content: 'H4sIAAAAAAAAE8tIzcnJVyjPL8pJAQCFEUoNCwAAAA==',
};

describe('useCommandRunOutputV2', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('demand-driven subscription', () => {
    it('skips query when no UI surface needs output', () => {
      renderHook(() =>
        useCommandRunOutputV2(createMockCommandRunner(), { panelOutputVisible: false })
      );
      expect(mockUseSessionQuery).toHaveBeenCalledWith('getRunOutputV2', 'skip');
      expect(mockControlOutput).not.toHaveBeenCalled();
    });

    it('subscribes when panel is visible', () => {
      mockUseSessionQuery.mockReturnValue({
        run: null,
        tail: null,
        chunks: [],
        fullOutputPending: false,
      });

      renderHook(() =>
        useCommandRunOutputV2(createMockCommandRunner({ activeRunId: 'run-panel' }), {
          panelOutputVisible: true,
        })
      );

      expect(mockUseSessionQuery).toHaveBeenCalledWith('getRunOutputV2', {
        runId: 'run-panel',
        loadFull: false,
      });
      expect(mockControlOutput).toHaveBeenCalledWith({
        runId: 'run-panel',
        action: 'observe',
      });
    });

    it('subscribes when palette modal is open', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-palette' },
        tail: null,
        chunks: [],
        fullOutputPending: false,
      });

      const runner = createMockCommandRunner({ activeRunId: 'run-palette' });
      const { result } = renderHook(() =>
        useCommandRunOutputV2(runner, { panelOutputVisible: false })
      );

      await act(async () => {
        result.current.palette.run('dev', 'pnpm dev');
      });

      expect(mockUseSessionQuery).toHaveBeenLastCalledWith('getRunOutputV2', {
        runId: 'run-palette',
        loadFull: false,
      });
    });
  });

  describe('observer lifecycle', () => {
    beforeEach(() => {
      mockUseSessionQuery.mockReturnValue({
        run: null,
        tail: null,
        chunks: [],
        fullOutputPending: false,
      });
    });

    it('clears observer on unmount', () => {
      const { unmount } = renderHook(() =>
        useCommandRunOutputV2(createMockCommandRunner({ activeRunId: 'run-observer' }), {
          panelOutputVisible: true,
        })
      );

      unmount();

      expect(mockControlOutput).toHaveBeenCalledWith({
        runId: 'run-observer',
        action: 'unobserve',
      });
    });
  });

  describe('decode output', () => {
    it('decodes gzip tail for running run', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-1' },
        tail: {
          compression: 'gzip',
          content: 'H4sIAAAAAAAAE8tIzcnJVyjPL8pJAQCFEUoNCwAAAA==',
          updatedAt: 1000,
          totalBytesWritten: 500,
        },
        chunks: [],
        fullOutputPending: false,
      });

      const { result } = renderHook(() =>
        useCommandRunOutputV2(createMockCommandRunner({ activeRunId: 'run-1' }), {
          panelOutputVisible: true,
        })
      );

      await waitFor(() => {
        expect(result.current.activeRunOutput.chunks).toHaveLength(1);
      });

      expect(result.current.activeRunOutput.chunks[0]!.chunkIndex).toBe(0);
    });

    it('decodes gzip chunks for completed run', async () => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'completed', _id: 'run-2' },
        tail: null,
        chunks: [{ content: encodedHello, chunkIndex: 0, timestamp: 1000 }],
        fullOutputPending: false,
      });

      const { result } = renderHook(() =>
        useCommandRunOutputV2(createMockCommandRunner({ activeRunId: 'run-2' }), {
          panelOutputVisible: true,
        })
      );

      await waitFor(() => {
        expect(result.current.activeRunOutput.chunks).toHaveLength(1);
      });
    });
  });

  describe('palette actions', () => {
    let mockRunner: CommandRunner;

    beforeEach(() => {
      mockUseSessionQuery.mockReturnValue({
        run: { status: 'running', _id: 'run-id-123', commandName: 'test' },
        tail: null,
        chunks: [{ content: 'hello', chunkIndex: 0, timestamp: 0 }],
        fullOutputPending: false,
      });
      mockRunner = createMockCommandRunner({ activeRunId: 'run-id-123' });
    });

    it('detach clears palette state without stopping command', async () => {
      const { result } = renderHook(() =>
        useCommandRunOutputV2(mockRunner, { panelOutputVisible: false })
      );

      await act(async () => {
        result.current.palette.run('dev', 'pnpm dev');
      });

      act(() => {
        result.current.palette.detach();
      });

      expect(result.current.palette.commandName).toBeNull();
      expect(mockRunner.stopCommand).not.toHaveBeenCalled();
    });

    it('close stops command and clears palette state', async () => {
      const { result } = renderHook(() =>
        useCommandRunOutputV2(mockRunner, { panelOutputVisible: false })
      );

      await act(async () => {
        result.current.palette.run('build', 'pnpm build');
      });

      act(() => {
        result.current.palette.close();
      });

      expect(mockRunner.stopCommand).toHaveBeenCalledWith('run-id-123');
      expect(result.current.palette.commandName).toBeNull();
    });
  });
});
