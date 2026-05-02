import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionList } from './SessionList';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

// ─── Fixture ──────────────────────────────────────────────────────────────────

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
    harnessName: 'harness',
    lastUsedConfig: { agent },
    status,
    createdBy: 'u1' as never,
    createdAt,
    lastActiveAt,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SessionList', () => {
  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(
      <SessionList workspaceId={'ws1' as never} selectedSessionId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('renders empty state when there are no sessions', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(
      <SessionList workspaceId={'ws1' as never} selectedSessionId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
  });

  it('renders sessions newest-first (highest createdAt at top)', () => {
    const older = makeSession('s1', 'builder', 1000, 1000);
    const newer = makeSession('s2', 'planner', 2000, 2000);
    // Backend returns ascending order
    mockUseSessionQuery.mockReturnValue([older, newer]);
    render(
      <SessionList workspaceId={'ws1' as never} selectedSessionId={null} onSelect={vi.fn()} />
    );
    const buttons = screen.getAllByRole('button');
    // newest (planner, createdAt=2000) should be first
    expect(buttons[0]).toHaveTextContent('planner');
    expect(buttons[1]).toHaveTextContent('builder');
  });

  it('calls onSelect with the correct id when a row is clicked', () => {
    const session = makeSession('s1', 'builder', 1000, 1000);
    mockUseSessionQuery.mockReturnValue([session]);
    const onSelect = vi.fn();
    render(
      <SessionList workspaceId={'ws1' as never} selectedSessionId={null} onSelect={onSelect} />
    );
    fireEvent.click(screen.getByRole('button', { name: /builder/i }));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});
