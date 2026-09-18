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
});
