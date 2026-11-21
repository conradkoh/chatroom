import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Discussion } from './discussion';

/**
 * Boundary mocks only: Convex session query/mutation. The component, the sync
 * hook, the dialogs, and the forms all run for real.
 */
const mocks = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
  useSessionMutation: vi.fn(),
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
  state: { exists: true, isActive: true } as Record<string, unknown>,
  messages: [] as Record<string, unknown>[],
  conclusion: null as Record<string, unknown> | null,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: mocks.useSessionQuery,
  useSessionMutation: mocks.useSessionMutation,
}));

type FunctionReference = Parameters<typeof getFunctionName>[0];
type User = ReturnType<typeof userEvent.setup>;

const message = {
  _id: 'm1',
  discussionKey: 'k',
  name: 'Ada',
  message: 'Hi',
  timestamp: 1,
};

function functionName(reference: FunctionReference): string {
  return getFunctionName(reference).split(':').pop() ?? '';
}

function renderDiscussion() {
  render(<Discussion title="Team Feedback" discussionKey="k" />);
}

/** Waits for the loading timer so the card actions are interactive. */
async function waitForCardLoaded() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Discussion actions' })).toBeEnabled()
  );
}

async function openDeleteDialog(user: User) {
  const messageCard = screen.getByText('Hi').parentElement;
  if (!messageCard) throw new Error('Message card not found');

  await user.click(within(messageCard).getByRole('button'));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  mocks.mutations = {
    createDiscussion: vi.fn().mockResolvedValue(undefined),
    addDiscussionMessage: vi.fn().mockResolvedValue(undefined),
    deleteDiscussionMessage: vi.fn().mockResolvedValue(undefined),
    concludeDiscussion: vi.fn().mockResolvedValue(undefined),
    updateConclusions: vi.fn().mockResolvedValue(undefined),
    reopenDiscussion: vi.fn().mockResolvedValue(undefined),
  };
  mocks.useSessionMutation.mockImplementation((reference: FunctionReference) => {
    return mocks.mutations[functionName(reference)];
  });

  mocks.state = { exists: true, isActive: true };
  mocks.messages = [message];
  mocks.conclusion = null;
  mocks.useSessionQuery.mockImplementation((reference: FunctionReference, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = functionName(reference);
    if (name === 'getDiscussionState') return mocks.state;
    if (name === 'getDiscussionMessages') return mocks.messages;
    if (name === 'getDiscussionConclusion') return mocks.conclusion;
    return undefined;
  });
});

describe('Discussion inline failures', () => {
  it('keeps an add failure in the dialog with the typed text', async () => {
    mocks.mutations.addDiscussionMessage.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    await user.click(screen.getByRole('button', { name: 'Add Contribution' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Your Name'), 'Ada');
    await user.type(within(dialog).getByLabelText('Your Thoughts'), 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    const alert = await within(dialog).findByRole('alert');
    expect(dialog).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to add message: Network down');
    expect(within(dialog).getByLabelText('Your Name')).toHaveValue('Ada');
    expect(within(dialog).getByLabelText('Your Thoughts')).toHaveValue('Hello');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows a create failure as a card alert outside any dialog', async () => {
    mocks.state = { exists: false, isActive: false };
    mocks.messages = [];
    mocks.mutations.createDiscussion.mockRejectedValueOnce(new Error('Boom'));
    renderDiscussion();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to create discussion: Boom');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a reopen failure as a card alert outside any dialog', async () => {
    mocks.state = { exists: true, isActive: false };
    mocks.conclusion = {
      _id: 'c1',
      discussionKey: 'k',
      conclusions: [{ text: 'Done', tags: ['task'] }],
      createdAt: 1,
    };
    mocks.mutations.reopenDiscussion.mockRejectedValueOnce(new Error('Nope'));
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    await user.click(screen.getByRole('button', { name: 'Discussion actions' }));
    await user.click(screen.getByRole('button', { name: 'Reopen Discussion' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to reopen discussion: Nope');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a conclude failure in the dialog with the typed conclusion', async () => {
    mocks.mutations.concludeDiscussion.mockRejectedValueOnce(new Error('Offline'));
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    await user.click(screen.getByRole('button', { name: 'Discussion actions' }));
    await user.click(screen.getByRole('button', { name: 'Conclude Discussion' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText('Enter a conclusion'), 'Ship it');
    await user.click(within(dialog).getByRole('button', { name: 'Conclude Discussion' }));

    const alert = await within(dialog).findByRole('alert');
    expect(dialog).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to conclude discussion: Offline');
    expect(within(dialog).getByPlaceholderText('Enter a conclusion')).toHaveValue('Ship it');
  });

  it('keeps the delete dialog open when deletion fails', async () => {
    mocks.mutations.deleteDiscussionMessage.mockRejectedValueOnce(new Error('Denied'));
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const alert = await within(dialog).findByRole('alert');
    expect(dialog).toBeInTheDocument();
    expect(alert).toHaveTextContent('Failed to delete message: Denied');
  });

  it('closes the delete dialog after a successful deletion', async () => {
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    const dialog = await openDeleteDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the previous failure when the dialog is reopened', async () => {
    mocks.mutations.addDiscussionMessage.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    renderDiscussion();
    await waitForCardLoaded();

    await user.click(screen.getByRole('button', { name: 'Add Contribution' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Your Name'), 'Ada');
    await user.type(within(dialog).getByLabelText('Your Thoughts'), 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Add Contribution' }));
    dialog = await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
