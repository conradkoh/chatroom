/**
 * Smoke tests for ProcessesPanel.
 *
 * Tests: renders header, sidebar items, detail panel switching, clear-stuck button.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProcessesPanel } from './ProcessesPanel';
import type {
  CommandRun,
  RunnableCommand,
  OutputChunk,
} from '../../../features/run-command/types/run';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue({ clearedCount: 0 }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    commands: {
      clearStuckCommandRuns: 'clearStuckCommandRuns',
    },
  },
}));

// Mock resizable panels as simple pass-throughs (drop unknown props to avoid TS spread errors)
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: React.PropsWithChildren) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: React.PropsWithChildren) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// Stub alert dialog
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: React.PropsWithChildren<{ open: boolean }>) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: React.PropsWithChildren<{ onClick: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

// Stub commandFavoritesStore
vi.mock('../../../features/run-command/hooks/useCommandFavorites', () => ({
  useCommandFavorites: () => ({
    favorites: new Set<string>(),
    toggle: vi.fn(),
    isFavorite: vi.fn(),
    revision: 0,
  }),
}));

// Stub TerminalView used inside OutputPanel
vi.mock('../../../features/run-command/components/TerminalView', () => ({
  TerminalView: React.forwardRef((_props: unknown, _ref: unknown) => (
    <div data-testid="terminal-view" />
  )),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeCommand = (name: string, subPath = '.'): RunnableCommand => ({
  _id: `cmd-${name}` as RunnableCommand['_id'],
  _creationTime: 0,
  machineId: 'machine-1',
  workingDir: '/workspace',
  syncedAt: 0,
  name,
  script: `pnpm ${name}`,
  source: 'package.json',
  subWorkspace: { type: 'npm', path: subPath, name },
});

const defaultRun: CommandRun = {
  _id: 'run-1' as CommandRun['_id'],
  commandName: 'dev',
  status: 'running',
  script: 'pnpm dev',
  pid: 1000,
  startedAt: Date.now(),
  exitCode: undefined,
  terminationReason: undefined,
};

const defaultChunks: OutputChunk[] = [];

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  commands: [makeCommand('dev'), makeCommand('build'), makeCommand('test', 'apps/api')],
  runs: [],
  activeRunOutput: { chunks: defaultChunks, run: null },
  onRunCommand: vi.fn(),
  onStopCommand: vi.fn(),
  onSelectRun: vi.fn(),
  onClearRun: vi.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProcessesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Processes panel header', () => {
    render(<ProcessesPanel {...defaultProps} />);
    expect(screen.getByText('Processes')).toBeInTheDocument();
  });

  it('renders workspace groups in the sidebar', () => {
    render(<ProcessesPanel {...defaultProps} />);
    // Should show the root workspace and apps/api workspace
    expect(screen.getAllByText(/Root|apps\/api/i).length).toBeGreaterThan(0);
  });

  it('shows clear-stuck button when machineId and workingDir are provided', () => {
    render(<ProcessesPanel {...defaultProps} />);
    expect(screen.getByRole('button', { name: /clear stuck/i })).toBeInTheDocument();
  });

  it('clear-stuck button is disabled when no running processes', () => {
    render(<ProcessesPanel {...defaultProps} runs={[]} />);
    const btn = screen.getByRole('button', { name: /clear stuck/i });
    expect(btn).toBeDisabled();
  });

  it('clear-stuck button is enabled when there are running processes', () => {
    render(<ProcessesPanel {...defaultProps} runs={[defaultRun]} />);
    const btn = screen.getByRole('button', { name: /clear stuck/i });
    expect(btn).not.toBeDisabled();
  });

  it('clicking clear-stuck opens the confirm dialog', () => {
    render(<ProcessesPanel {...defaultProps} runs={[defaultRun]} />);
    const btn = screen.getByRole('button', { name: /clear stuck/i });
    fireEvent.click(btn);
    expect(screen.getByTestId('alert-dialog')).toBeInTheDocument();
  });

  it('does not render clear-stuck button when machineId is absent', () => {
    render(<ProcessesPanel {...defaultProps} machineId={null} />);
    expect(screen.queryByRole('button', { name: /clear stuck/i })).not.toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<ProcessesPanel {...defaultProps} />);
    // Both desktop and mobile layouts render in test env (CSS media queries not applied)
    expect(screen.getAllByPlaceholderText(/search commands/i).length).toBeGreaterThan(0);
  });

  it('filters workspace list on search input', () => {
    render(<ProcessesPanel {...defaultProps} />);
    const inputs = screen.getAllByPlaceholderText(/search commands/i);
    fireEvent.change(inputs[0], { target: { value: 'dev' } });
    // After search there's at least one search result count header
    expect(screen.getAllByText(/search results/i).length).toBeGreaterThan(0);
  });

  it('shows running process count when runs are active', () => {
    render(<ProcessesPanel {...defaultProps} runs={[defaultRun]} />);
    expect(screen.getAllByText(/Running \(1\)/i).length).toBeGreaterThan(0);
  });
});
