/**
 * TimelineContextMessage — context divider with creator role label.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import { TimelineContextMessage } from './TimelineContextMessage';
import type { Message } from '../../types/message';

function makeContextMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'ctx-1',
    type: 'new-context',
    senderRole: 'system',
    content: 'Working on login refactor',
    _creationTime: 1_000,
    ...overrides,
  };
}

describe('TimelineContextMessage', () => {
  it('renders creator role in chip when contextCreatedBy is set', () => {
    render(
      <TimelineContextMessage message={makeContextMessage({ contextCreatedBy: 'planner' })} />
    );

    expect(screen.getByText('New Context')).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
  });

  it('shows creator role in modal title when opened', async () => {
    const user = userEvent.setup();
    render(
      <TimelineContextMessage message={makeContextMessage({ contextCreatedBy: 'planner' })} />
    );

    await user.click(screen.getByRole('button', { name: /New Context/i }));

    expect(screen.getByText('Context — Planner')).toBeInTheDocument();
  });

  it('omits role label when contextCreatedBy is absent', () => {
    render(<TimelineContextMessage message={makeContextMessage()} />);

    expect(screen.getByText('New Context')).toBeInTheDocument();
    expect(screen.queryByText('Planner')).not.toBeInTheDocument();
  });
});
