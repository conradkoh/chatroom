import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Discussion } from './discussion';

const mocks = vi.hoisted(() => ({
  state: undefined as unknown,
  messages: undefined as unknown,
  conclusion: undefined as unknown,
  mutations: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

// Data port: the Convex query/mutation adapters, keyed by generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'discussions:getDiscussionState') return mocks.state;
      if (name === 'discussions:getDiscussionMessages') return mocks.messages;
      if (name === 'discussions:getDiscussionConclusion') return mocks.conclusion;
      throw new Error(`Unexpected query in Discussion test: ${name}`);
    },
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      // Stable per name so hook dependency arrays do not churn.
      mocks.mutations[name] ??= vi.fn().mockResolvedValue(undefined);
      return mocks.mutations[name];
    },
  };
});

const ACTIVE_STATE = {
  key: 'd',
  title: 'Topic',
  isActive: true,
  createdAt: 1,
  exists: true,
};

const CONCLUDED_STATE = { ...ACTIVE_STATE, isActive: false };

const MESSAGES = [
  { _id: 'm1', discussionKey: 'd', name: 'Ann', message: 'First thought', timestamp: 1 },
];

const CONCLUSION = {
  _id: 'c1',
  discussionKey: 'd',
  conclusions: [{ text: 'Ship it', tags: ['decision'] }],
  createdAt: 1,
};

function renderDiscussion() {
  return render(<Discussion title="Topic" discussionKey="d" />);
}

/** The panel's feedback slot sits above the message list, outside any dialog. */
function panelFeedback() {
  return screen.getByTestId('discussion-feedback');
}

/** The actions trigger stays disabled until the first query settles. */
async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: 'Discussion actions' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('Discussion inline failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.mutations).forEach((k) => delete mocks.mutations[k]);
    mocks.state = ACTIVE_STATE;
    mocks.messages = MESSAGES;
    mocks.conclusion = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the unsent contribution and shows the add failure inside the dialog', async () => {
    const user = userEvent.setup();
    mocks.mutations['discussions:addDiscussionMessage'] = vi
      .fn()
      .mockRejectedValue(new Error('Message too long'));
    renderDiscussion();

    await user.click(await screen.findByRole('button', { name: /Add Contribution/ }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Your Name'), 'Ann');
    await user.type(within(dialog).getByLabelText('Your Thoughts'), 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Failed to add message');
    expect(alert).toHaveTextContent('Message too long');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Your Thoughts')).toHaveValue('Hello');
  });

  it('closes the contribution dialog and shows no confirmation on success', async () => {
    const user = userEvent.setup();
    mocks.mutations['discussions:addDiscussionMessage'] = vi.fn().mockResolvedValue(undefined);
    renderDiscussion();

    await user.click(await screen.findByRole('button', { name: /Add Contribution/ }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Your Name'), 'Ann');
    await user.type(within(dialog).getByLabelText('Your Thoughts'), 'Hello');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a delete failure at the top of the panel', async () => {
    const user = userEvent.setup();
    mocks.mutations['discussions:deleteDiscussionMessage'] = vi
      .fn()
      .mockRejectedValue(new Error('nope'));
    renderDiscussion();

    expect(await screen.findByText('First thought')).toBeInTheDocument();

    const actions = document.querySelector('.lucide-ellipsis')?.closest('button');
    expect(actions).not.toBeNull();
    await user.click(actions as HTMLButtonElement);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(panelFeedback()).toHaveTextContent('Failed to delete message'));
    expect(screen.getByText('First thought')).toBeVisible();
  });

  it('shows no success text after a delete', async () => {
    const user = userEvent.setup();
    mocks.mutations['discussions:deleteDiscussionMessage'] = vi.fn().mockResolvedValue(undefined);
    renderDiscussion();

    expect(await screen.findByText('First thought')).toBeInTheDocument();

    const actions = document.querySelector('.lucide-ellipsis')?.closest('button');
    expect(actions).not.toBeNull();
    await user.click(actions as HTMLButtonElement);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Message deleted')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a conclude failure inside the conclude dialog and keeps the entries', async () => {
    const user = userEvent.setup();
    mocks.mutations['discussions:concludeDiscussion'] = vi
      .fn()
      .mockRejectedValue(new Error('Server rejected'));
    renderDiscussion();

    await openActionsMenu(user);
    await user.click(await screen.findByRole('button', { name: /Conclude Discussion/ }));

    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText('Enter a conclusion');
    await user.type(input, 'Ship it');
    await user.click(within(dialog).getByRole('button', { name: 'Conclude Discussion' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Failed to conclude discussion');
    expect(alert).toHaveTextContent('Server rejected');
    expect(dialog).toBeInTheDocument();
    expect(input).toHaveValue('Ship it');
  });

  it('shows a reopen failure at the top of the panel', async () => {
    const user = userEvent.setup();
    mocks.state = CONCLUDED_STATE;
    mocks.conclusion = CONCLUSION;
    mocks.mutations['discussions:reopenDiscussion'] = vi.fn().mockRejectedValue(new Error('nope'));
    renderDiscussion();

    await openActionsMenu(user);
    await user.click(await screen.findByRole('button', { name: /Reopen Discussion/ }));

    await waitFor(() => expect(panelFeedback()).toHaveTextContent('Failed to reopen discussion'));
  });

  it('shows a create failure at the top of the panel when the discussion does not exist yet', async () => {
    mocks.state = { ...ACTIVE_STATE, exists: false, isActive: false };
    mocks.mutations['discussions:createDiscussion'] = vi.fn().mockRejectedValue(new Error('nope'));
    renderDiscussion();

    await waitFor(() => expect(panelFeedback()).toHaveTextContent('Failed to create discussion'));
  });

  it('dismisses the panel error with Dismiss', async () => {
    const user = userEvent.setup();
    mocks.state = CONCLUDED_STATE;
    mocks.conclusion = CONCLUSION;
    mocks.mutations['discussions:reopenDiscussion'] = vi.fn().mockRejectedValue(new Error('nope'));
    renderDiscussion();

    await openActionsMenu(user);
    await user.click(await screen.findByRole('button', { name: /Reopen Discussion/ }));

    await waitFor(() => expect(panelFeedback()).toHaveTextContent('Failed to reopen discussion'));
    await user.click(within(panelFeedback()).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('discussion-feedback')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
