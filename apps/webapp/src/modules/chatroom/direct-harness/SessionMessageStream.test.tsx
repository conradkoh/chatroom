import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionMessageStream } from './SessionMessageStream';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

const SESSION_ROW_ID = 'sr1' as never;

describe('SessionMessageStream', () => {
  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading messages/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when there are no messages', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it('renders 2 messages with their content visible', () => {
    mockUseSessionQuery.mockReturnValue([
      {
        _id: 'm1' as never,
        harnessSessionRowId: SESSION_ROW_ID,
        seq: 1,
        content: 'Hello from agent',
        timestamp: Date.now(),
      },
      {
        _id: 'm2' as never,
        harnessSessionRowId: SESSION_ROW_ID,
        seq: 2,
        content: 'Second message',
        timestamp: Date.now(),
      },
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello from agent')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });
});
