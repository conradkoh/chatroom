import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledPromptsSidebarSection } from './ScheduledPromptsSidebarSection';
import { clearPendingScheduledPrompt } from '../stores/scheduledPromptComposerStore';

const mocks = vi.hoisted(() => ({
  rows: undefined as Doc<'chatroom_scheduledPrompts'>[] | undefined,
  remove: vi.fn(),
  otherMutation: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === getFunctionName(api.scheduledPrompts.listUpcoming)) return mocks.rows;
    if (name === getFunctionName(api.scheduledPrompts.get)) {
      const { scheduledPromptId } = args as { scheduledPromptId: string };
      const row = mocks.rows?.find((candidate) => candidate._id === scheduledPromptId);
      if (!row) {
        throw Object.assign(new Error('Scheduled prompt not found'), {
          data: { code: 'NOT_FOUND' },
        });
      }
      return row;
    }
    if (name === getFunctionName(api.scheduledPrompts.listTriggeredMessages)) return [];
    if (name === getFunctionName(api.scheduledPrompts.list)) return mocks.rows ?? [];
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    return name === getFunctionName(api.scheduledPrompts.remove)
      ? mocks.remove
      : mocks.otherMutation;
  },
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

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

function rowElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]'));
}

function rowTitles(): (string | null)[] {
  return rowElements().map((row) => row.querySelector('p')?.textContent ?? null);
}

function firstRow(): HTMLElement {
  return rowElements()[0]!;
}

describe('ScheduledPromptsSidebarSection', () => {
  beforeEach(() => {
    mocks.rows = undefined;
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue(undefined);
    mocks.otherMutation.mockReset();
    mocks.otherMutation.mockResolvedValue(undefined);
    clearPendingScheduledPrompt();
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

  it('labels a capped list as 20+', () => {
    mocks.rows = Array.from({ length: 20 }, (_, index) =>
      makePrompt(`sp-${index}`, `Prompt ${index}`)
    );
    renderSection();

    expect(screen.getByText('Scheduled (20+)')).toBeDefined();
  });

  it('shows an open-ended View more label when the list is capped', () => {
    mocks.rows = Array.from({ length: 20 }, (_, index) =>
      makePrompt(`sp-${index}`, `Prompt ${index}`)
    );
    renderSection();

    const footer = screen.getByRole('button', { name: /view more/i });
    expect(footer).toHaveTextContent('View More');
    expect(footer.textContent).not.toMatch(/\d/);
  });

  it('keeps the count in View More for an uncapped list', () => {
    mocks.rows = [ROW_A, ROW_B, ROW_C, ROW_D, makePrompt('sp-e', 'Epsilon')];
    renderSection();

    expect(screen.getByText('View More (2 more items)')).toBeDefined();
  });

  it('offers View More for the hidden rows and opens the management dialog', async () => {
    mocks.rows = [ROW_A, ROW_B, ROW_C, ROW_D];
    renderSection();

    fireEvent.click(screen.getByText('View More (1 more items)'));

    expect(await screen.findByText('Automatically send messages on a schedule.')).toBeDefined();
  });

  it('deletes a row on a single tap and drops it when the query updates', () => {
    mocks.rows = [ROW_A, ROW_B];
    const { rerender } = renderSection();

    fireEvent.click(within(firstRow()).getByRole('button', { name: 'Delete' }));

    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith({ scheduledPromptId: 'sp-a' });
    expect(screen.queryByText('Trigger history')).toBeNull();

    mocks.rows = [ROW_B];
    rerender(<ScheduledPromptsSidebarSection chatroomId={CHATROOM_ID} />);

    expect(rowTitles()).toEqual(['Beta']);
    expect(screen.queryByText('Click again to delete')).toBeNull();
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

  it('opens the detail dialog from a row click and shows the prompt', async () => {
    mocks.rows = [ROW_A];
    renderSection();
    expect(screen.queryByText('Trigger history')).toBeNull();

    fireEvent.click(firstRow());

    expect(await screen.findByText('Trigger history')).toBeDefined();
    expect(screen.getAllByText('Alpha')).toHaveLength(2);
  });

  it('opens the detail dialog from Enter on a row', async () => {
    mocks.rows = [ROW_A];
    renderSection();

    fireEvent.keyDown(firstRow(), { key: 'Enter' });

    expect(await screen.findByText('Trigger history')).toBeDefined();
  });

  it('does not open the detail dialog from a control click', () => {
    mocks.rows = [ROW_A];
    renderSection();
    const row = firstRow();

    fireEvent.click(within(row).getByRole('button', { name: 'Start in new session' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Mode: Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText('Trigger history')).toBeNull();
  });

  it('closes the detail dialog when its row leaves the list', async () => {
    mocks.rows = [ROW_A, ROW_B];
    const { rerender } = renderSection();

    fireEvent.click(firstRow());
    expect(await screen.findByText('Trigger history')).toBeDefined();

    mocks.rows = [ROW_B];
    rerender(<ScheduledPromptsSidebarSection chatroomId={CHATROOM_ID} />);

    await waitFor(() => expect(screen.queryByText('Trigger history')).toBeNull());
    expect(screen.getByText('Scheduled (1)')).toBeDefined();
    expect(rowTitles()).toEqual(['Beta']);
  });
});
