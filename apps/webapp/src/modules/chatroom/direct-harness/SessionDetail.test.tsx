import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SessionDetail } from './SessionDetail';
import type { HarnessSessionSummary } from './hooks/useListSessions';

const SESSION_ROW_ID = 'sr1' as never;

function makeSessionSummary(
  overrides?: Partial<HarnessSessionSummary>
): HarnessSessionSummary {
  return {
    _id: SESSION_ROW_ID as never,
    status: 'active' as const,
    harnessName: 'my-harness',
    lastUsedConfig: { agent: 'builder' },
    workspaceId: 'ws1' as never,
    createdAt: Date.now() - 60_000,
    lastActiveAt: Date.now() - 10_000,
    ...overrides,
  };
}

describe('SessionDetail', () => {
  it('renders agent name from summary', () => {
    const summary = makeSessionSummary({ lastUsedConfig: { agent: 'planner' } });
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} sessionSummary={summary} />);
    expect(screen.getByText('planner')).toBeInTheDocument();
  });

  it('renders harness name from summary', () => {
    const summary = makeSessionSummary({ harnessName: 'my-opencode' });
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} sessionSummary={summary} />);
    expect(screen.getByText('my-opencode')).toBeInTheDocument();
  });

  it('renders status dot', () => {
    const summary = makeSessionSummary({ status: 'active' });
    render(<SessionDetail sessionRowId={SESSION_ROW_ID} sessionSummary={summary} />);
    expect(screen.getByLabelText('Active')).toBeInTheDocument();
  });
});
