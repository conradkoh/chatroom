import { act, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@workspace/backend/convex/_generated/api';
import { getFunctionName } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkQueue } from './WorkQueue';
import type { WorkQueueProps } from './WorkQueue/types';

const mocks = vi.hoisted(() => ({
  counts: undefined as
    { pending: number; acknowledged: number; in_progress: number; queued: number } | undefined,
  tasks: undefined as { _id: string; status: string; content: string }[] | undefined,
  promote: vi.fn(),
  otherMutation: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown) => {
    const functionName = getFunctionName(query as FunctionReference<'query'>);
    if (functionName === getFunctionName(api.tasks.listTasks)) return mocks.tasks;
    if (functionName === getFunctionName(api.tasks.getTaskCounts)) return mocks.counts;
    if (functionName === getFunctionName(api.messages.listQueued)) return [];
    if (functionName === getFunctionName(api.backlog.listBacklogItems)) return [];
    throw new Error(`Unexpected WorkQueue query: ${functionName}`);
  },
  useSessionMutation: (mutation: unknown) =>
    getFunctionName(mutation as FunctionReference<'mutation'>) ===
    getFunctionName(api.tasks.promoteNextTask)
      ? mocks.promote
      : mocks.otherMutation,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    info: mocks.toastInfo,
    error: mocks.toastError,
  },
}));

vi.mock('./sidebar/SidebarSection', () => ({
  SIDEBAR_PREVIEW_LIMIT: 4,
  SidebarSection: {
    Root: ({ title, children }: { title: string; children: ReactNode }) => (
      <section aria-label={title}>{children}</section>
    ),
  },
}));

vi.mock('./WorkQueue/TaskItem', () => ({
  TaskItem: ({ task, onClick }: { task: { content: string }; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {task.content}
    </button>
  ),
}));

vi.mock('./WorkQueue/QueuedMessageItem', () => ({ QueuedMessageItem: () => null }));
vi.mock('./WorkQueue/PendingReviewModal/PendingReviewBacklogItem', () => ({
  PendingReviewBacklogItem: () => null,
}));
vi.mock('./WorkQueue/CompactBacklogItem', () => ({ CompactBacklogItem: () => null }));
vi.mock('./WorkQueue/CurrentTasksModal', () => ({ CurrentTasksModal: () => null }));
vi.mock('./WorkQueue/QueuedMessagesModal', () => ({ QueuedMessagesModal: () => null }));
vi.mock('./WorkQueue/BacklogQueueModal', () => ({ BacklogQueueModal: () => null }));
vi.mock('./BacklogCreateModal', () => ({ BacklogCreateModal: () => null }));
vi.mock('./BacklogItemDetailModal', () => ({ BacklogItemDetailModal: () => null }));
vi.mock('./QueueFrontMessageModal', () => ({ QueueFrontMessageModal: () => null }));
vi.mock('./ReviewPanel', () => ({ ReviewPanel: () => null }));
vi.mock('./TaskDetailModal', () => ({ TaskDetailModal: () => null }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: () => null,
  DropdownMenuTrigger: () => null,
}));

const chatroomId = 'chatroom-one' as WorkQueueProps['chatroomId'];
const eligibleCounts = { pending: 0, acknowledged: 0, in_progress: 0, queued: 1 };

describe('WorkQueue manual queue recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.counts = eligibleCounts;
    mocks.tasks = [];
    mocks.promote = vi.fn().mockResolvedValue({ reason: 'success' });
    mocks.otherMutation = vi.fn().mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastInfo.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function elapse(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('shows after two seconds from occupancy alone, without agent status context', async () => {
    render(<WorkQueue chatroomId={chatroomId} />);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(1999);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(1);
    expect(screen.getByRole('button', { name: 'Start Next' })).toBeInTheDocument();
  });

  it.each(['pending', 'acknowledged', 'in_progress'])(
    'hides recovery while a %s task is active',
    async (status) => {
      mocks.counts = { ...eligibleCounts, [status]: 1 };
      render(<WorkQueue chatroomId={chatroomId} />);
      await elapse(2500);
      expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    }
  );

  it('hides during loading and when the queue is empty', async () => {
    mocks.tasks = undefined;
    const { rerender } = render(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2500);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    mocks.tasks = [];
    mocks.counts = { ...eligibleCounts, queued: 0 };
    rerender(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2500);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
  });

  it('restarts the full delay after a visible notice becomes busy and when switching rooms', async () => {
    const { rerender } = render(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2000);
    expect(screen.getByRole('button', { name: 'Start Next' })).toBeInTheDocument();

    mocks.counts = { ...eligibleCounts, pending: 1 };
    rerender(<WorkQueue chatroomId={chatroomId} />);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(2500);

    mocks.counts = eligibleCounts;
    rerender(<WorkQueue chatroomId={chatroomId} />);
    await elapse(1999);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(1);
    expect(screen.getByRole('button', { name: 'Start Next' })).toBeInTheDocument();

    rerender(<WorkQueue chatroomId={'chatroom-two' as WorkQueueProps['chatroomId']} />);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(1999);
    expect(screen.queryByRole('button', { name: 'Start Next' })).not.toBeInTheDocument();
    await elapse(1);
    expect(screen.getByRole('button', { name: 'Start Next' })).toBeInTheDocument();
  });

  it('calls promotion once with the room id, reports success, and prevents duplicate clicks', async () => {
    let resolvePromotion!: (value: { reason: 'success' }) => void;
    mocks.promote.mockReturnValue(
      new Promise((resolve) => {
        resolvePromotion = resolve;
      })
    );
    render(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2000);
    const button = screen.getByRole('button', { name: 'Start Next' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.promote).toHaveBeenCalledTimes(1);
    expect(mocks.promote).toHaveBeenCalledWith({ chatroomId });
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Starting…' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => resolvePromotion({ reason: 'success' }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started next queued task');
  });

  it.each([
    ['active_task_exists', 'A task is already active'],
    ['no_queued_tasks', 'No queued tasks remain'],
  ] as const)('reports %s result', async (reason, message) => {
    mocks.promote.mockResolvedValue({ reason });
    render(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Start Next' }));
    await act(async () => Promise.resolve());
    expect(mocks.toastInfo).toHaveBeenCalledWith(message);
  });

  it('reports errors and allows another attempt', async () => {
    mocks.promote.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({
      reason: 'success',
    });
    render(<WorkQueue chatroomId={chatroomId} />);
    await elapse(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Start Next' }));
    await act(async () => Promise.resolve());
    expect(mocks.toastError).toHaveBeenCalledWith('network unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Start Next' }));
    await act(async () => Promise.resolve());
    expect(mocks.promote).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started next queued task');
  });
});
