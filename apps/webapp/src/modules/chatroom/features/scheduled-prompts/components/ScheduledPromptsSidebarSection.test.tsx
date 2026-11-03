import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledPromptsSidebarSection } from './ScheduledPromptsSidebarSection';

const mocks = vi.hoisted(() => ({
  rows: undefined as Doc<'chatroom_scheduledPrompts'>[] | undefined,
  remove: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.rows,
  useSessionMutation: () => mocks.remove,
}));

vi.mock('./ScheduledPromptDetailDialog', () => ({
  ScheduledPromptDetailDialog: ({
    open,
    scheduledPromptId,
  }: {
    open: boolean;
    scheduledPromptId: string;
  }) => (open ? <div data-testid="detail-dialog">{scheduledPromptId}</div> : null),
}));

vi.mock('./ScheduledPromptsDialog', () => ({
  ScheduledPromptsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="manage-dialog">Manage scheduled prompts</div> : null,
}));

const CHATROOM_ID = 'room-1' as Id<'chatroom_rooms'>;

function todayAt(hour: number, minute: number): number {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function makePrompt(
  id: string,
  title: string,
  overrides: Partial<Doc<'chatroom_scheduledPrompts'>> = {}
): Doc<'chatroom_scheduledPrompts'> {
  return {
    _id: id as Id<'chatroom_scheduledPrompts'>,
    _creationTime: 1,
    chatroomId: CHATROOM_ID,
    name: title,
    prompt: `${title} prompt`,
    scheduleKind: 'interval',
    intervalMinutes: 30,
    isRunnable: true,
    nextRunAt: todayAt(14, 30),
    createdBy: 'user-1' as Id<'users'>,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const ROW_A = makePrompt('sp-a', 'Alpha', { nextRunAt: todayAt(10, 0) });
const ROW_B = makePrompt('sp-b', 'Beta', { nextRunAt: todayAt(11, 0) });
const ROW_C = makePrompt('sp-c', 'Gamma', { nextRunAt: todayAt(12, 0) });
const ROW_D = makePrompt('sp-d', 'Delta', { nextRunAt: todayAt(13, 0) });

function renderSection() {
  return render(<ScheduledPromptsSidebarSection chatroomId={CHATROOM_ID} />);
}

function rowTitles(): (string | null)[] {
  return screen
    .getAllByTestId('scheduled-prompt-sidebar-row')
    .map((row) => row.querySelector('p')?.textContent ?? null);
}

describe('ScheduledPromptsSidebarSection', () => {
  beforeEach(() => {
    mocks.rows = undefined;
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue(undefined);
  });

  it('renders nothing while the query is loading', () => {
    const { container } = renderSection();

    expect(container.querySelector('[data-testid="scheduled-prompts-sidebar-section"]')).toBeNull();
    expect(screen.queryByText(/Scheduled/)).toBeNull();
  });

  it('renders nothing when there are no upcoming prompts', () => {
    mocks.rows = [];
    const { container } = renderSection();

    expect(container.querySelector('[data-testid="scheduled-prompts-sidebar-section"]')).toBeNull();
    expect(screen.queryByText(/Scheduled/)).toBeNull();
  });

  it('shows the count and at most three rows in query order', () => {
    mocks.rows = [ROW_A, ROW_B, ROW_C, ROW_D];
    renderSection();

    expect(screen.getByText('Scheduled (4)')).toBeDefined();
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('offers View More for the hidden rows and opens the management dialog', () => {
    mocks.rows = [ROW_A, ROW_B, ROW_C, ROW_D];
    renderSection();

    fireEvent.click(screen.getByText('View More (1 more items)'));

    expect(screen.getByTestId('manage-dialog')).toBeDefined();
  });

  it('requires two taps to delete a row', () => {
    mocks.rows = [ROW_A];
    renderSection();
    const deleteButton = within(screen.getByTestId('scheduled-prompt-sidebar-row')).getByTestId(
      'scheduled-prompt-delete'
    );

    fireEvent.click(deleteButton);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(deleteButton).toHaveAttribute('title', 'Click again to delete');

    fireEvent.click(deleteButton);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith({ scheduledPromptId: 'sp-a' });
  });

  it('unmounts when the last row disappears', () => {
    mocks.rows = [ROW_A];
    const { container, rerender } = renderSection();
    expect(screen.getByText('Scheduled (1)')).toBeDefined();

    mocks.rows = [];
    rerender(<ScheduledPromptsSidebarSection chatroomId={CHATROOM_ID} />);

    expect(container.querySelector('[data-testid="scheduled-prompts-sidebar-section"]')).toBeNull();
    expect(screen.queryByText(/Scheduled/)).toBeNull();
  });
});
