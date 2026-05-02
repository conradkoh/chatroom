import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn(() => vi.fn().mockResolvedValue({}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...(args as [])),
}));

import { SessionDetail } from './SessionDetail';

const SESSION_ROW_ID = 'sr1' as never;

function makeSession(overrides?: Partial<Record<string, unknown>>) {
  return {
    _id: SESSION_ROW_ID,
    _creationTime: Date.now(),
    agent: 'builder',
    harnessName: 'my-harness',
    status: 'active' as const,
    workspaceId: 'ws1' as never,
    createdAt: Date.now() - 60_000,
    lastActiveAt: Date.now() - 10_000,
    createdBy: 'u1' as never,
    ...overrides,
  };
}

describe('SessionDetail', () => {
  it('renders loading state when session query returns undefined', () => {
    // First call: getSession → undefined; second call: streamSessionMessages (won't render)
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading session/i)).toBeInTheDocument();
  });

  it('renders unavailable state when session query returns null', () => {
    mockUseSessionQuery.mockReturnValue(null);
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/session unavailable/i)).toBeInTheDocument();
  });

  it('renders agent name when session is loaded', () => {
    // First call: getSession; second call: streamSessionMessages (return [])
    mockUseSessionQuery
      .mockReturnValueOnce(makeSession({ agent: 'planner' }))
      .mockReturnValueOnce([]);
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('planner')).toBeInTheDocument();
  });
});
