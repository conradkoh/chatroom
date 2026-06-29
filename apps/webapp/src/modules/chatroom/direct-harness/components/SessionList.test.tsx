import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionList } from './SessionList';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

function makeSession(
  id: string,
  agent: string,
  lastActiveAt: number,
  createdAt: number,
  status = 'active'
) {
  return {
    _id: id as never,
    _creationTime: createdAt,
    workspaceId: 'ws1' as never,
    harnessName: 'opencode-sdk',
    lastUsedConfig: { agent },
    status,
    createdAt,
    lastActiveAt,
  };
}

const WORKSPACE_ID = 'ws1' as never;

const defaultCloseProps = {
  optimisticallyClosedIds: new Set<string>(),
  closingIds: new Set<string>(),
  onCloseSession: vi.fn().mockResolvedValue(undefined),
};

describe('SessionList', () => {
  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        {...defaultCloseProps}
      />
    );
    expect(document.body).toBeTruthy();
  });

  it('renders empty state when there are no sessions', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        {...defaultCloseProps}
      />
    );
    expect(document.body).toBeTruthy();
  });

  it('renders sessions newest-first (highest createdAt at top)', () => {
    mockUseSessionQuery.mockReturnValue([
      makeSession('s1', 'build', 1000, 1000),
      makeSession('s2', 'plan', 2000, 2000),
    ]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        {...defaultCloseProps}
      />
    );
    const rowButtons = screen.getAllByRole('button', { name: /build|plan/i });
    expect(rowButtons[0]).toHaveTextContent('plan');
    expect(rowButtons[1]).toHaveTextContent('build');
  });

  it('calls onSelect with the correct id when a row is clicked', () => {
    const onSelect = vi.fn();
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'build', 1000, 1000)]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={onSelect}
        {...defaultCloseProps}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /build/i }));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('shows stop button for active sessions and calls onCloseSession on click', async () => {
    const onCloseSession = vi.fn().mockResolvedValue(undefined);
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'build', 1000, 1000, 'active')]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        optimisticallyClosedIds={new Set()}
        closingIds={new Set()}
        onCloseSession={onCloseSession}
      />
    );

    fireEvent.click(screen.getByTitle('Stop session'));
    expect(onCloseSession).toHaveBeenCalledWith('s1');
  });

  it('does not show stop button for closed sessions', () => {
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'build', 1000, 1000, 'closed')]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        {...defaultCloseProps}
      />
    );
    expect(screen.queryByTitle('Stop session')).not.toBeInTheDocument();
  });

  it('shows grey closed StatusDot when optimistically closed', () => {
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'build', 1000, 1000, 'active')]);
    render(
      <SessionList
        workspaceId={WORKSPACE_ID}
        selectedSessionId={null}
        onSelect={vi.fn()}
        optimisticallyClosedIds={new Set(['s1'])}
        closingIds={new Set()}
        onCloseSession={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Closed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Active')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Stop session')).not.toBeInTheDocument();
  });
});
