/**
 * TaskDetailModal tests — structured handoff rendering + click-to-edit
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailModal } from './TaskDetailModal';
import type { TaskStatus } from '../../../domain/entities/task';

const mocks = vi.hoisted(() => ({
  redeliverTask: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.redeliverTask,
  useSessionQuery: () => undefined,
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockRichTextEditor({
      value,
      onChange,
      initialClickCoords,
    }: {
      value: string;
      onChange: (value: string) => void;
      initialClickCoords?: { left: number; top: number } | null;
    }) {
      return (
        <textarea
          data-testid="task-rich-text-editor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-initial-click-coords={
            initialClickCoords ? `${initialClickCoords.left},${initialClickCoords.top}` : ''
          }
        />
      );
    },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    tasks: {
      updateTask: 'tasks:updateTask',
      deleteTask: 'tasks:deleteTask',
      stopTask: 'tasks:stopTask',
      completeTask: 'tasks:completeTask',
    },
  },
}));

vi.mock('../attachments', () => ({
  useAttachments: () => ({
    add: vi.fn(),
    isAttached: () => false,
  }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

const ENVELOPE_TASK = {
  _id: 'task-env-1' as Id<'chatroom_tasks'>,
  chatroomId: 'room-1' as Id<'chatroom_rooms'>,
  createdBy: 'planner',
  content: `<user-message>User request here</user-message>
<additional-context>Supporting constraints</additional-context>
<grounding>Research notes</grounding>
<builder-handoff>## Goal\nDo the thing</builder-handoff>`,
  status: 'pending' as TaskStatus,
  createdAt: 1000,
  updatedAt: 1000,
  queuePosition: 1,
};

const STRUCTURED_REPORT_TASK = {
  _id: 'task-report-1' as Id<'chatroom_tasks'>,
  chatroomId: 'room-1' as Id<'chatroom_rooms'>,
  createdBy: 'planner',
  content: `<handoff-overview>## Summary\nDone</handoff-overview>
<handoff-proofs>## Proof</handoff-proofs>
<handoff-direction>## Decisions\nJWT</handoff-direction>
<handoff-notes>## Notes\nNone</handoff-notes>
<handoff-action>## Tech Debt\nNone</handoff-action>`,
  status: 'in_progress' as TaskStatus,
  createdAt: 2000,
  updatedAt: 2000,
  queuePosition: 0,
};

const PLAIN_TASK = {
  _id: 'task-plain-1' as Id<'chatroom_tasks'>,
  chatroomId: 'room-1' as Id<'chatroom_rooms'>,
  createdBy: 'user',
  content: '## Summary\nJust a plain markdown task.',
  status: 'pending' as TaskStatus,
  createdAt: 3000,
  updatedAt: 3000,
  queuePosition: 2,
};

const RETRYING_DELIVERY_TASK = {
  ...PLAIN_TASK,
  deliveryFailure: { reason: 'delivery_retrying' as const, occurredAt: 4000 },
};

const PAUSED_DELIVERY_TASK = {
  ...PLAIN_TASK,
  deliveryFailure: { reason: 'redelivery_exhausted' as const, occurredAt: 4000 },
};

const COMPLETED_RETRYING_DELIVERY_TASK = {
  ...RETRYING_DELIVERY_TASK,
  status: 'completed' as TaskStatus,
};

const COMPLETED_PAUSED_DELIVERY_TASK = {
  ...PAUSED_DELIVERY_TASK,
  status: 'completed' as TaskStatus,
};

const defaultProps = {
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onForceComplete: vi.fn(),
};

beforeEach(() => {
  mocks.redeliverTask.mockReset();
});

describe('TaskDetailModal — structured handoff', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders HandoffEnvelopeView for structured envelope task', () => {
    render(<TaskDetailModal isOpen task={ENVELOPE_TASK} {...defaultProps} />);
    expect(screen.getByTestId('handoff-envelope-view')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-user-message')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-additional-context')).toBeInTheDocument();
  });

  it('renders HandoffReportView for structured report task', () => {
    render(<TaskDetailModal isOpen task={STRUCTURED_REPORT_TASK} {...defaultProps} />);
    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
  });

  it('renders plain markdown for non-handoff task', () => {
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);
    expect(screen.getByText('Just a plain markdown task.')).toBeInTheDocument();
    expect(screen.queryByTestId('handoff-envelope-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('handoff-report-view')).not.toBeInTheDocument();
  });

  it('opens in view mode for an editable task (no Save on open)', () => {
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('clicking the content area enters edit mode', () => {
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    fireEvent.click(screen.getByText('Just a plain markdown task.'));

    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('does not show an Edit item in the Actions menu', () => {
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    fireEvent.click(screen.getByText('Actions'));
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('clicking the Raw toggle in HandoffEnvelopeView does NOT enter edit mode', () => {
    render(<TaskDetailModal isOpen task={ENVELOPE_TASK} {...defaultProps} />);

    fireEvent.click(screen.getByTestId('handoff-raw-toggle'));

    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('renders a retrying warning with its tooltip when delivery keeps failing', () => {
    render(<TaskDetailModal isOpen task={RETRYING_DELIVERY_TASK} {...defaultProps} />);

    const warning = screen.getByTitle(
      'Delivery has failed more than 3 times and is still being retried (up to once a minute). Check the agent and its provider.'
    );
    expect(warning).toHaveTextContent('Retrying delivery — something may be wrong');
  });

  it('renders a paused delivery when automatic redelivery has stopped', () => {
    render(<TaskDetailModal isOpen task={PAUSED_DELIVERY_TASK} {...defaultProps} />);

    expect(screen.getByText('Delivery paused — restart the agent to resume')).toBeInTheDocument();
    expect(
      screen.getByTitle(
        'Automatic redelivery stopped for this task (repeated failures or a turn without a handoff). Restart the agent to resume.'
      )
    ).toBeInTheDocument();
  });

  it('hides the retrying warning on a completed task', () => {
    render(<TaskDetailModal isOpen task={COMPLETED_RETRYING_DELIVERY_TASK} {...defaultProps} />);

    expect(
      screen.queryByText('Retrying delivery — something may be wrong')
    ).not.toBeInTheDocument();
  });

  it('still shows a paused delivery on a completed task', () => {
    render(<TaskDetailModal isOpen task={COMPLETED_PAUSED_DELIVERY_TASK} {...defaultProps} />);

    expect(screen.getByText('Delivery paused — restart the agent to resume')).toBeInTheDocument();
  });
});

describe('TaskDetailModal — redeliver feedback', () => {
  const clickRedeliver = () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redeliver task' }));
    });

  it('explains an already-pending redelivery as status text on the modal', async () => {
    mocks.redeliverTask.mockResolvedValue({ skipped: true });
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    await clickRedeliver();

    expect(mocks.redeliverTask).toHaveBeenCalledWith({ taskId: PLAIN_TASK._id });
    expect(screen.getByRole('status')).toHaveTextContent('Task delivery is already pending');
  });

  it('stays silent when the redelivery is queued', async () => {
    mocks.redeliverTask.mockResolvedValue({ skipped: false });
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    await clickRedeliver();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a redelivery failure as alert text on the modal', async () => {
    mocks.redeliverTask.mockRejectedValue(new Error('Redelivery is unavailable'));
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    await clickRedeliver();

    expect(screen.getByRole('alert')).toHaveTextContent('Redelivery is unavailable');
  });

  it('dismisses the info notice with its Dismiss button', async () => {
    mocks.redeliverTask.mockResolvedValue({ skipped: true });
    render(<TaskDetailModal isOpen task={PLAIN_TASK} {...defaultProps} />);

    await clickRedeliver();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
