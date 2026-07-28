/**
 * TaskDetailModal tests — structured handoff rendering
 */

import { render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailModal } from './TaskDetailModal';
import type { TaskStatus } from '../../../domain/entities/task';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
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

const ENVELOPE_TASK = {
  _id: 'task-env-1' as Id<'chatroom_tasks'>,
  chatroomId: 'room-1' as Id<'chatroom_rooms'>,
  createdBy: 'planner',
  content: `<user-message>User request here</user-message>
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

const defaultProps = {
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onForceComplete: vi.fn(),
};

describe('TaskDetailModal — structured handoff', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders HandoffEnvelopeView for enhancer envelope task', () => {
    render(<TaskDetailModal isOpen task={ENVELOPE_TASK} {...defaultProps} />);
    expect(screen.getByTestId('handoff-envelope-view')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-user-message')).toBeInTheDocument();
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
});
