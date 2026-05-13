/**
 * ActiveCommandRunsIndicator unit tests
 *
 * Covers:
 * - Renders nothing when no active runs
 * - Renders with correct count when ≥1 active run
 * - Click calls attach() + openDialog('command-palette')
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockListActiveRuns = vi.fn().mockReturnValue([]);
const mockOpenDialog = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(() => mockListActiveRuns()),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      listActiveRuns: 'listActiveRuns',
    },
  },
}));

vi.mock('../context/CommandDialogContext', () => ({
  useCommandDialog: vi.fn(() => ({
    openDialog: mockOpenDialog,
    closeDialog: vi.fn(),
    activeDialog: null,
  })),
}));

// Import after mocks
import { ActiveCommandRunsIndicator } from './ActiveCommandRunsIndicator';
import type { InlineCommandState } from '../hooks/useInlineCommandOutput';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockInlineCommand(overrides: Partial<InlineCommandState> = {}): InlineCommandState {
  return {
    commandName: null,
    script: null,
    isRunning: false,
    output: [],
    run: vi.fn(),
    stop: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ActiveCommandRunsIndicator', () => {
  const defaultProps = {
    machineId: 'test-machine',
    workingDir: '/test/project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveRuns.mockReturnValue([]);
  });

  it('renders nothing when there are no active runs', () => {
    mockListActiveRuns.mockReturnValue([]);
    const inlineCommand = createMockInlineCommand();

    const { container } = render(
      <ActiveCommandRunsIndicator {...defaultProps} inlineCommand={inlineCommand} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when activeRuns is undefined (query loading)', () => {
    mockListActiveRuns.mockReturnValue(undefined);
    const inlineCommand = createMockInlineCommand();

    const { container } = render(
      <ActiveCommandRunsIndicator {...defaultProps} inlineCommand={inlineCommand} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the count when there is 1 active run', () => {
    mockListActiveRuns.mockReturnValue([
      { _id: 'run-1', commandName: 'dev', script: 'pnpm dev', status: 'running', startedAt: 1000 },
    ]);
    const inlineCommand = createMockInlineCommand();

    render(<ActiveCommandRunsIndicator {...defaultProps} inlineCommand={inlineCommand} />);

    // Should show the count "1"
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders the count when there are multiple active runs', () => {
    mockListActiveRuns.mockReturnValue([
      { _id: 'run-1', commandName: 'dev', script: 'pnpm dev', status: 'running', startedAt: 2000 },
      {
        _id: 'run-2',
        commandName: 'test',
        script: 'pnpm test',
        status: 'pending',
        startedAt: 1000,
      },
    ]);
    const inlineCommand = createMockInlineCommand();

    render(<ActiveCommandRunsIndicator {...defaultProps} inlineCommand={inlineCommand} />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls attach() with most recent run and opens command palette on click', () => {
    const activeRuns = [
      { _id: 'run-1', commandName: 'dev', script: 'pnpm dev', status: 'running', startedAt: 2000 },
      {
        _id: 'run-2',
        commandName: 'test',
        script: 'pnpm test',
        status: 'pending',
        startedAt: 1000,
      },
    ];
    mockListActiveRuns.mockReturnValue(activeRuns);
    const inlineCommand = createMockInlineCommand();

    render(<ActiveCommandRunsIndicator {...defaultProps} inlineCommand={inlineCommand} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Should attach to the most recent run (index 0 — sorted descending by startedAt)
    expect(inlineCommand.attach).toHaveBeenCalledWith('run-1', 'dev', 'pnpm dev');
    // Should open the command palette
    expect(mockOpenDialog).toHaveBeenCalledWith('command-palette');
  });
});
