import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateInviteCard } from './CreateInviteCard';

import { useIsMobile } from '@/hooks/useIsMobile';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

type User = ReturnType<typeof userEvent.setup>;

async function openDialogAndFill(user: User) {
  await user.click(screen.getByRole('button', { name: /create invite/i }));
  await user.type(screen.getByLabelText('Invitee name'), 'Jane Doe');
  await user.type(screen.getByLabelText('Invitee email'), 'jane@example.com');
}

function getSubmitButton() {
  return within(screen.getByRole('dialog')).getByRole('button', { name: 'Create invite' });
}

async function createInviteAndGetCopyButton(user: User) {
  await openDialogAndFill(user);
  await user.click(getSubmitButton());
  return screen.findByRole('button', { name: 'Copy' });
}

describe('CreateInviteCard', () => {
  const onCreate = vi.fn();

  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    onCreate.mockReset();
    onCreate.mockResolvedValue({ code: 'ABC123' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides form until trigger is clicked (desktop dialog)', async () => {
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);

    expect(screen.queryByLabelText('Invitee name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create invite/i }));
    expect(screen.getByLabelText('Invitee name')).toBeInTheDocument();
  });

  it('opens drawer on mobile', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);

    await user.click(screen.getByRole('button', { name: /create invite/i }));
    expect(screen.getByLabelText('Invitee name')).toBeInTheDocument();
  });

  it('keeps typed values and shows the create error above submit when creation fails', async () => {
    onCreate.mockRejectedValueOnce(new Error('Invitee email is already registered'));
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);

    await user.click(getSubmitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invitee email is already registered'
    );
    expect(screen.getByLabelText('Invitee name')).toHaveValue('Jane Doe');
    expect(screen.getByLabelText('Invitee email')).toHaveValue('jane@example.com');
  });

  it('shows Operation failed when the rejection has no message', async () => {
    onCreate.mockRejectedValueOnce('network down');
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);

    await user.click(getSubmitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Operation failed');
  });

  it('clears the create error when a field is edited', async () => {
    onCreate.mockRejectedValueOnce(new Error('Invitee email is already registered'));
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);
    await user.click(getSubmitButton());
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Invitee name'), '!');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the create error at the start of the next submit', async () => {
    onCreate.mockRejectedValueOnce(new Error('Invitee email is already registered'));
    onCreate.mockReturnValueOnce(new Promise(() => {})); // second attempt stays pending
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);
    const submit = getSubmitButton(); // keep the reference: the label changes to "Creating..."
    await user.click(submit);
    await screen.findByRole('alert');

    await user.click(submit);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the create error when the dialog is closed and reopened', async () => {
    onCreate.mockRejectedValueOnce(new Error('Invitee email is already registered'));
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);
    await user.click(getSubmitButton());
    await screen.findByRole('alert');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /create invite/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the created invite panel and no message on success', async () => {
    const user = userEvent.setup();
    render(<CreateInviteCard onCreate={onCreate} />);
    await openDialogAndFill(user);

    await user.click(getSubmitButton());

    expect(await screen.findByText('Invite code created')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('swaps Copy to Copied with a check icon, then reverts after 2 seconds', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CreateInviteCard onCreate={onCreate} />);
    const copyButton = await createInviteAndGetCopyButton(user);

    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith('ABC123');
    const copied = await screen.findByRole('button', { name: 'Copied' });
    expect(copied.querySelector('.lucide-check')).not.toBeNull();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows the copy failure inline and clears it on the next copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the hook logs the rejection
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    render(<CreateInviteCard onCreate={onCreate} />);
    const copyButton = await createInviteAndGetCopyButton(user);

    await user.click(copyButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to copy invite code to clipboard'
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
