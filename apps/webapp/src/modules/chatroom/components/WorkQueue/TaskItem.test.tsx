/**
 * TaskItem — cancel-enhancer control rendering and click behavior.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

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
    assignedTo: 'enhancer',
    ...overrides,
  };
}

describe('TaskItem cancel enhancer', () => {
  it('shows cancel button for enhancer-assigned task when showCancelEnhancer is set', () => {
    render(
      <TaskItem
        task={makeTask({ assignedTo: 'enhancer' })}
        isProtected
        showCancelEnhancer
        onCancelEnhancer={vi.fn()}
      />
    );

    expect(screen.getByTestId('cancel-enhancer-task')).toBeInTheDocument();
  });

  it('hides cancel button when showCancelEnhancer is false', () => {
    render(
      <TaskItem
        task={makeTask({ assignedTo: 'enhancer' })}
        isProtected
        showCancelEnhancer={false}
        onCancelEnhancer={vi.fn()}
      />
    );

    expect(screen.queryByTestId('cancel-enhancer-task')).not.toBeInTheDocument();
  });

  it('hides cancel button when no onCancelEnhancer provided', () => {
    render(<TaskItem task={makeTask({ assignedTo: 'enhancer' })} isProtected showCancelEnhancer />);

    expect(screen.queryByTestId('cancel-enhancer-task')).not.toBeInTheDocument();
  });

  it('calls onCancelEnhancer and stops propagation (row onClick not fired)', () => {
    const onCancelEnhancer = vi.fn();
    const onClick = vi.fn();
    render(
      <TaskItem
        task={makeTask({ assignedTo: 'enhancer' })}
        isProtected
        showCancelEnhancer
        onCancelEnhancer={onCancelEnhancer}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByTestId('cancel-enhancer-task'));

    expect(onCancelEnhancer).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
