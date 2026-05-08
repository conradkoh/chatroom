import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StatusDot } from './StatusDot';
import type { SessionStatus } from './StatusDot';

describe('StatusDot', () => {
  const statuses: SessionStatus[] = ['pending', 'spawning', 'active', 'idle', 'closed', 'failed'];

  it.each(statuses)('renders with correct aria-label for status "%s"', (status) => {
    render(<StatusDot status={status} />);
    // Use the label defined in STATUS_STYLES rather than capitalising the status key,
    // since some statuses have a different display label (e.g. 'idle' → 'Reconnecting').
    const labelMap: Record<SessionStatus, string> = {
      pending:   'Pending',
      spawning:  'Spawning',
      active:    'Active',
      idle:      'Reconnecting',
      closed:    'Closed',
      failed:    'Failed',
    };
    expect(screen.getByRole('generic', { name: labelMap[status] })).toBeInTheDocument();
  });
});
