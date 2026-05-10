import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionList } from './SessionList';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

function makeSession(id: string, agent: string, lastActiveAt: number, createdAt: number, status = 'active') {
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

describe('SessionList', () => {
  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<SessionList workspaceId={WORKSPACE_ID} selectedSessionId={null} onSelect={vi.fn()} />);
    // Loading state renders nothing (empty flex-1) — just confirm no crash
    expect(document.body).toBeTruthy();
  });

  it('renders empty state when there are no sessions', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionList workspaceId={WORKSPACE_ID} selectedSessionId={null} onSelect={vi.fn()} />);
    // Empty list renders nothing (empty flex-1) — confirm no crash
    expect(document.body).toBeTruthy();
  });

  it('renders sessions newest-first (highest createdAt at top)', () => {
    mockUseSessionQuery.mockReturnValue([
      makeSession('s1', 'build', 1000, 1000),
      makeSession('s2', 'plan', 2000, 2000),
    ]);
    render(<SessionList workspaceId={WORKSPACE_ID} selectedSessionId={null} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    // s2 (newer) should be first
    expect(buttons[0]).toHaveTextContent('plan');
    expect(buttons[1]).toHaveTextContent('build');
  });

  it('calls onSelect with the correct id when a row is clicked', () => {
    const onSelect = vi.fn();
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'build', 1000, 1000)]);
    render(<SessionList workspaceId={WORKSPACE_ID} selectedSessionId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});
