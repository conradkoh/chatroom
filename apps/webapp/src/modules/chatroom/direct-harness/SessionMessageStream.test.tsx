import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionMessageStream } from './SessionMessageStream';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

// scrollIntoView is not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const SESSION_ROW_ID = 'sr1' as never;

describe('SessionMessageStream', () => {
  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when there are no messages', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it('renders 2 messages with their content visible', () => {
    mockUseSessionQuery.mockReturnValue([
      { _id: 'm1' as never, role: 'user', content: 'Hello', seq: 1, timestamp: 1000, harnessSessionRowId: SESSION_ROW_ID },
      { _id: 'm2' as never, role: 'assistant', content: 'Hi there', seq: 2, timestamp: 2000, harnessSessionRowId: SESSION_ROW_ID },
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });
});
