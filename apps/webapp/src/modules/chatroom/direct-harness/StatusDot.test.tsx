import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StatusDot } from './StatusDot';
import type { SessionStatus } from './StatusDot';

describe('StatusDot', () => {
  const statuses: SessionStatus[] = ['pending', 'spawning', 'active', 'idle', 'closed', 'failed'];

  it.each(statuses)('renders with correct aria-label for status "%s"', (status) => {
    render(<StatusDot status={status} />);
    const expectedLabel =
      status.charAt(0).toUpperCase() + status.slice(1); // e.g. 'pending' → 'Pending'
    expect(screen.getByRole('generic', { name: expectedLabel })).toBeInTheDocument();
  });
});
