import { render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it } from 'vitest';

import { TaskItem } from './TaskItem';
import type { Task } from './types';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    _id: 'task-1' as Id<'chatroom_tasks'>,
    content: 'Implement the feature',
    status: 'in_progress',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    queuePosition: 1,
    assignedTo: 'builder',
    ...overrides,
  };
}

describe('TaskItem', () => {
  it('shows the latest delivery failure reason', () => {
    render(
      <TaskItem
        task={makeTask({
          status: 'in_progress',
          deliveryFailure: { reason: 'no_agent_config', occurredAt: Date.now() },
        })}
      />
    );

    expect(screen.getByText('Delivery failed: no agent config')).toBeInTheDocument();
  });

  it('renders a paused delivery when the agent finished without a handoff', () => {
    render(
      <TaskItem
        task={makeTask({
          deliveryFailure: { reason: 'redelivery_exhausted', occurredAt: Date.now() },
        })}
      />
    );

    expect(
      screen.getByText('Delivery paused — agent finished without a handoff')
    ).toBeInTheDocument();
    expect(screen.queryByText(/redelivery/i)).not.toBeInTheDocument();
  });

  it('renders a retrying warning with its tooltip when delivery keeps failing', () => {
    render(
      <TaskItem
        task={makeTask({
          deliveryFailure: { reason: 'delivery_retrying', occurredAt: Date.now() },
        })}
      />
    );

    const warning = screen.getByTitle(
      'Delivery has failed more than 3 times and is still being retried (up to once a minute). Check the agent and its provider.'
    );
    expect(warning).toHaveTextContent('Retrying delivery — something may be wrong');
  });
});
