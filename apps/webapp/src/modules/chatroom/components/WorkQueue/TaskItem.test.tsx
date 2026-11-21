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

  it('renders a paused delivery when automatic redelivery has stopped', () => {
    render(
      <TaskItem
        task={makeTask({
          deliveryFailure: { reason: 'redelivery_exhausted', occurredAt: Date.now() },
        })}
      />
    );

    const paused = screen.getByTitle(
      'Automatic redelivery stopped for this task (repeated failures or a turn without a handoff). Restart the agent to resume.'
    );
    expect(paused).toHaveTextContent('Delivery paused — restart the agent to resume');
    expect(screen.queryByText(/redelivery/i)).not.toBeInTheDocument();
  });

  it('hides the retrying warning on a completed task', () => {
    render(
      <TaskItem
        task={makeTask({
          status: 'completed',
          deliveryFailure: { reason: 'delivery_retrying', occurredAt: Date.now() },
        })}
      />
    );

    expect(
      screen.queryByText('Retrying delivery — something may be wrong')
    ).not.toBeInTheDocument();
  });

  it('still shows other failure reasons on a completed task', () => {
    render(
      <TaskItem
        task={makeTask({
          status: 'completed',
          deliveryFailure: { reason: 'no_agent_config', occurredAt: Date.now() },
        })}
      />
    );

    expect(screen.getByText('Delivery failed: no agent config')).toBeInTheDocument();
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
