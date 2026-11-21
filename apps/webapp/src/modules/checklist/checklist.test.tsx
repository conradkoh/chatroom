import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Checklist } from './checklist';

/**
 * Boundary mocks only: Convex session query/mutation. The component, the sync
 * hook, and the inline input all run for real.
 */
const mocks = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
  useSessionMutation: vi.fn(),
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  state: { exists: true, isActive: true } as Record<string, unknown>,
  items: [] as Record<string, unknown>[],
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: mocks.useSessionQuery,
  useSessionMutation: mocks.useSessionMutation,
}));

type FunctionReference = Parameters<typeof getFunctionName>[0];
type User = ReturnType<typeof userEvent.setup>;

function functionName(reference: FunctionReference): string {
  return getFunctionName(reference).split(':').pop() ?? '';
}

const milk = {
  _id: 'i1',
  _creationTime: 1,
  checklistKey: 'k',
  text: 'Buy milk',
  isCompleted: false,
  order: 0,
  createdAt: 1,
};

const ADD_FAILED_MESSAGE = 'Failed to add item. Text restored for retry.';

function renderChecklist() {
  return render(<Checklist title="Morning Checklist" checklistKey="k" />);
}

async function findAddInput() {
  return screen.findByPlaceholderText('Add new item...');
}

async function openMenuAndClick(user: User, name: string) {
  await user.click(await screen.findByRole('button', { name: 'Checklist actions' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  mocks.mutations = {
    createChecklist: vi.fn().mockResolvedValue(undefined),
    addChecklistItem: vi.fn().mockResolvedValue(undefined),
    toggleChecklistItem: vi.fn().mockResolvedValue(undefined),
    deleteChecklistItem: vi.fn().mockResolvedValue(undefined),
    concludeChecklist: vi.fn().mockResolvedValue(undefined),
    reopenChecklist: vi.fn().mockResolvedValue(undefined),
    clearCompletedItems: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    reorderChecklistItems: vi.fn().mockResolvedValue(undefined),
  };
  mocks.useSessionMutation.mockImplementation(
    (reference: FunctionReference) => mocks.mutations[functionName(reference)]
  );
  mocks.state = { exists: true, isActive: true };
  mocks.items = [milk];
  mocks.useSessionQuery.mockImplementation((reference: FunctionReference) => {
    const name = functionName(reference);
    if (name === 'getChecklistState') return mocks.state;
    if (name === 'getChecklistItems') return mocks.items;
    return undefined;
  });
});

describe('Checklist add failures', () => {
  it('keeps a failed add in the field with the typed text and no card alert', async () => {
    const user = userEvent.setup();
    mocks.mutations.addChecklistItem.mockRejectedValueOnce(new Error('Network down'));
    renderChecklist();

    const input = await findAddInput();
    await user.type(input, 'Buy eggs{Enter}');

    const message = await screen.findByText(ADD_FAILED_MESSAGE);
    expect(message).toHaveAttribute('role', 'alert');
    expect(input).toHaveValue('Buy eggs');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', message.id);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(message);
  });

  it('clears the field message when the user types', async () => {
    const user = userEvent.setup();
    mocks.mutations.addChecklistItem.mockRejectedValueOnce(new Error('Network down'));
    renderChecklist();

    const input = await findAddInput();
    await user.type(input, 'Buy eggs{Enter}');
    await screen.findByText(ADD_FAILED_MESSAGE);

    await user.type(input, '!');

    expect(screen.queryByText(ADD_FAILED_MESSAGE)).toBeNull();
  });

  it('clears the field message when the next submit starts', async () => {
    const user = userEvent.setup();
    mocks.mutations.addChecklistItem.mockRejectedValueOnce(new Error('Network down'));
    let rejectAdd!: (error: Error) => void;
    mocks.mutations.addChecklistItem.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectAdd = reject;
      })
    );
    renderChecklist();

    const input = await findAddInput();
    await user.type(input, 'Buy eggs{Enter}');
    await screen.findByText(ADD_FAILED_MESSAGE);

    await user.click(input);
    await user.keyboard('{Enter}');

    expect(screen.queryByText(ADD_FAILED_MESSAGE)).toBeNull();

    await act(async () => {
      rejectAdd(new Error('Network down'));
    });

    expect(await screen.findByText(ADD_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('restores the field message when the input remounts after a failed add', async () => {
    const user = userEvent.setup();
    let rejectAdd!: (error: Error) => void;
    mocks.mutations.addChecklistItem.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectAdd = reject;
      })
    );
    const { rerender } = renderChecklist();

    const input = await findAddInput();
    await user.type(input, 'Buy eggs{Enter}');

    // Concluding the checklist unmounts the inline input while the add is pending.
    mocks.state = { exists: true, isActive: false };
    rerender(<Checklist title="Morning Checklist" checklistKey="k" />);

    await act(async () => {
      rejectAdd(new Error('Network down'));
    });

    mocks.state = { exists: true, isActive: true };
    rerender(<Checklist title="Morning Checklist" checklistKey="k" />);

    const restoredInput = await findAddInput();
    expect(restoredInput).toHaveValue('Buy eggs');
    expect(await screen.findByText(ADD_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('keeps Enter on empty text silent', async () => {
    const user = userEvent.setup();
    renderChecklist();

    const input = await findAddInput();
    await user.click(input);
    await user.keyboard('{Enter}');

    expect(mocks.mutations.addChecklistItem).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Checklist sync failures', () => {
  it('shows a toggle failure as one card alert above the list', async () => {
    const user = userEvent.setup();
    mocks.mutations.toggleChecklistItem.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    await user.click(await screen.findByRole('checkbox'));

    const alert = await screen.findByText('Failed to update item. Please try again.');
    expect(alert).toBeInTheDocument();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Failed to update item. Please try again.');
    expect(
      alerts[0].compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('clears the card alert when the next checklist action starts', async () => {
    const user = userEvent.setup();
    mocks.mutations.toggleChecklistItem.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    await user.click(await screen.findByRole('checkbox'));
    await screen.findByText('Failed to update item. Please try again.');

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a conclude failure as a card alert', async () => {
    const user = userEvent.setup();
    mocks.mutations.concludeChecklist.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    await openMenuAndClick(user, 'Conclude Checklist');

    expect(
      await screen.findByText('Failed to conclude checklist. Please try again.')
    ).toBeInTheDocument();
    expect(screen.queryByText(ADD_FAILED_MESSAGE)).toBeNull();
  });

  it('shows a reopen failure as a card alert', async () => {
    const user = userEvent.setup();
    mocks.state = { exists: true, isActive: false };
    mocks.items = [milk];
    mocks.mutations.reopenChecklist.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    await openMenuAndClick(user, 'Reopen Checklist');

    expect(
      await screen.findByText('Failed to reopen checklist. Please try again.')
    ).toBeInTheDocument();
  });

  it('shows a clear-completed failure as a card alert', async () => {
    const user = userEvent.setup();
    mocks.items = [{ ...milk, isCompleted: true }];
    mocks.mutations.clearCompletedItems.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    await openMenuAndClick(user, 'Clear Completed');

    expect(
      await screen.findByText('Failed to clear completed items. Please try again.')
    ).toBeInTheDocument();
  });

  it('shows a delete failure as a card alert', async () => {
    const user = userEvent.setup();
    mocks.mutations.deleteChecklistItem.mockRejectedValueOnce(new Error('Offline'));
    renderChecklist();

    const listItem = await screen.findByRole('listitem');
    await user.click(within(listItem).getByRole('button'));

    expect(await screen.findByText('Failed to delete item. Please try again.')).toBeInTheDocument();
  });

  it('hides Clear Completed and shows no alert when nothing is completed', async () => {
    const user = userEvent.setup();
    mocks.items = [milk];
    renderChecklist();

    await screen.findByRole('listitem');
    await user.click(screen.getByRole('button', { name: 'Checklist actions' }));

    await screen.findByRole('menuitem', { name: 'Conclude Checklist' });
    expect(screen.queryByRole('menuitem', { name: 'Clear Completed' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a concluded checklist without drag handles, input, or Clear Completed', async () => {
    const user = userEvent.setup();
    mocks.state = { exists: true, isActive: false };
    mocks.items = [{ ...milk, isCompleted: true }];
    const { container } = renderChecklist();

    const listItem = await screen.findByRole('listitem');
    expect(listItem).toHaveAttribute('draggable', 'false');
    expect(container.querySelector('.lucide-grip-vertical')).toBeNull();
    expect(screen.queryByPlaceholderText('Add new item...')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Checklist actions' }));
    await screen.findByRole('menuitem', { name: 'Reopen Checklist' });
    expect(screen.queryByRole('menuitem', { name: 'Clear Completed' })).toBeNull();
  });
});
