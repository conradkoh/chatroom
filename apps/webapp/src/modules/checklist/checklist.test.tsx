import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Checklist } from './checklist';

const mocks = vi.hoisted(() => ({
  state: undefined as unknown,
  items: undefined as unknown,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

// Data port: the Convex query/mutation adapters, keyed by generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'checklists:getChecklistState') return mocks.state;
      if (name === 'checklists:getChecklistItems') return mocks.items;
      throw new Error(`Unexpected query in Checklist test: ${name}`);
    },
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      // Stable per name so hook dependency arrays do not churn.
      mocks.mutations[name] ??= vi.fn().mockResolvedValue(undefined);
      return mocks.mutations[name];
    },
  };
});

const ITEM = {
  _id: 'item-1',
  _creationTime: 1,
  checklistKey: 'k',
  text: 'Existing item',
  isCompleted: false,
  order: 0,
  createdAt: 1,
};

function renderChecklist() {
  return render(<Checklist title="Tasks" checklistKey="k" />);
}

describe('Checklist inline failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.mutations).forEach((k) => delete mocks.mutations[k]);
    mocks.state = {
      _id: 's1',
      _creationTime: 1,
      key: 'k',
      title: 'Tasks',
      isActive: true,
      createdAt: 1,
      exists: true,
    };
    mocks.items = [ITEM];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the add failure in the card and restores the typed text', async () => {
    const user = userEvent.setup();
    mocks.mutations['checklists:addChecklistItem'] = vi.fn().mockRejectedValue(new Error('boom'));
    renderChecklist();

    const input = await screen.findByPlaceholderText('Add new item...');
    await user.type(input, 'Buy milk');
    await user.keyboard('{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to add item. Text restored for retry.');
    expect(input).toHaveValue('Buy milk');
  });

  it('shows a toggle failure and clears it on Dismiss', async () => {
    const user = userEvent.setup();
    mocks.mutations['checklists:toggleChecklistItem'] = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    renderChecklist();

    await user.click(await screen.findByRole('checkbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update item. Please try again.'
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a delete failure in the card', async () => {
    const user = userEvent.setup();
    mocks.mutations['checklists:deleteChecklistItem'] = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    renderChecklist();

    expect(await screen.findByText('Existing item')).toBeInTheDocument();

    const deleteButton = document.querySelector('.lucide-trash-2')?.closest('button');
    expect(deleteButton).not.toBeNull();
    await user.click(deleteButton as HTMLButtonElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to delete item. Please try again.'
    );
  });

  it('clears a failure when the add input is edited', async () => {
    const user = userEvent.setup();
    mocks.mutations['checklists:addChecklistItem'] = vi.fn().mockRejectedValue(new Error('boom'));
    renderChecklist();

    const input = await screen.findByPlaceholderText('Add new item...');
    await user.type(input, 'Buy milk');
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to add item. Text restored for retry.'
    );

    await user.type(input, '!');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no success confirmation after a successful add', async () => {
    const user = userEvent.setup();
    renderChecklist();

    const input = await screen.findByPlaceholderText('Add new item...');
    await user.type(input, 'Buy milk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(mocks.mutations['checklists:addChecklistItem']).toHaveBeenCalled());
    await waitFor(() => expect(input).toHaveValue(''));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Item added successfully')).not.toBeInTheDocument();
  });

  it('scopes the error to the card and does not hide the list', async () => {
    const user = userEvent.setup();
    mocks.mutations['checklists:toggleChecklistItem'] = vi
      .fn()
      .mockRejectedValue(new Error('boom'));
    renderChecklist();

    await user.click(await screen.findByRole('checkbox'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update item. Please try again.'
    );
    expect(screen.getByText('Existing item')).toBeVisible();
    // InlineFeedback puts data-testid on the alert element itself, so scope the text within it.
    const feedbackBox = screen.getByTestId('checklist-feedback');
    expect(feedbackBox).toHaveAttribute('role', 'alert');
    expect(within(feedbackBox).getByText('Failed to update item. Please try again.')).toBeVisible();
  });
});
