import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateInviteCard } from './CreateInviteCard';

import { useIsMobile } from '@/hooks/useIsMobile';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
}));

let user: ReturnType<typeof userEvent.setup>;

describe('CreateInviteCard', () => {
  const onCreate = vi.fn().mockResolvedValue({ code: 'ABC123' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsMobile).mockReturnValue(false);
    onCreate.mockResolvedValue({ code: 'ABC123' });
    mocks.writeText.mockResolvedValue(undefined);
    // user-event would otherwise install its own clipboard stub over this mock.
    user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  it('hides form until trigger is clicked (desktop dialog)', async () => {
    render(<CreateInviteCard onCreate={onCreate} />);

    expect(screen.queryByLabelText('Invitee name')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create invite/i }));
    expect(screen.getByLabelText('Invitee name')).toBeInTheDocument();
  });

  it('opens drawer on mobile', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<CreateInviteCard onCreate={onCreate} />);

    await user.click(screen.getByRole('button', { name: /create invite/i }));
    expect(screen.getByLabelText('Invitee name')).toBeInTheDocument();
  });

  describe('inline feedback', () => {
    async function openAndSubmit(name = 'Jane Doe', email = 'jane@example.com') {
      await user.click(screen.getByRole('button', { name: /create invite/i }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Invitee name'), name);
      await user.type(within(dialog).getByLabelText('Invitee email'), email);
      await user.click(within(dialog).getByRole('button', { name: 'Create invite' }));
      return dialog;
    }

    it('shows a create failure under the form and keeps the typed values', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      onCreate.mockRejectedValueOnce(new Error('invite exploded'));

      render(<CreateInviteCard onCreate={onCreate} />);
      const dialog = await openAndSubmit();

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveAttribute('data-testid', 'invite-create-feedback');
      expect(alert).toHaveTextContent('invite exploded');
      expect(within(dialog).getByLabelText('Invitee name')).toHaveValue('Jane Doe');
      expect(within(dialog).getByLabelText('Invitee email')).toHaveValue('jane@example.com');
    });

    it('shows the created code and no alert on success', async () => {
      onCreate.mockResolvedValueOnce({ code: 'WXYZ2345' });

      render(<CreateInviteCard onCreate={onCreate} />);
      const dialog = await openAndSubmit();

      expect(await within(dialog).findByText('Invite code created')).toBeInTheDocument();
      expect(within(dialog).getByText('WXYZ-2345')).toBeInTheDocument();
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect(within(dialog).queryByRole('status')).toBeNull();
    });

    it('copies the code, flips to a check for 2 s and shows no message', async () => {
      onCreate.mockResolvedValueOnce({ code: 'WXYZ2345' });

      render(<CreateInviteCard onCreate={onCreate} />);
      const dialog = await openAndSubmit();
      await within(dialog).findByText('Invite code created');

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const copyButton = within(dialog).getByRole('button', { name: 'Copy' });
      await user.click(copyButton);
      await act(async () => {});

      expect(mocks.writeText).toHaveBeenCalledWith('WXYZ-2345');
      expect(copyButton.querySelector('.lucide-check')).not.toBeNull();
      expect(within(dialog).queryByTestId('invite-create-feedback')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(copyButton.querySelector('.lucide-copy')).not.toBeNull();
      expect(copyButton.querySelector('.lucide-check')).toBeNull();
      vi.useRealTimers();
    });

    it('shows a clipboard rejection as alert text', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.writeText.mockRejectedValueOnce(new Error('denied'));
      onCreate.mockResolvedValueOnce({ code: 'WXYZ2345' });

      render(<CreateInviteCard onCreate={onCreate} />);
      const dialog = await openAndSubmit();
      await within(dialog).findByText('Invite code created');

      const copyButton = within(dialog).getByRole('button', { name: 'Copy' });
      await user.click(copyButton);

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('Failed to copy invite code to clipboard');
      await waitFor(() => expect(copyButton.querySelector('.lucide-check')).toBeNull());
    });

    it('clears the slot when the dialog closes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      onCreate.mockRejectedValueOnce(new Error('invite exploded'));

      render(<CreateInviteCard onCreate={onCreate} />);
      const dialog = await openAndSubmit();
      await within(dialog).findByRole('alert');

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      await user.click(screen.getByRole('button', { name: /create invite/i }));
      const reopened = await screen.findByRole('dialog');
      expect(within(reopened).queryByRole('alert')).toBeNull();
    });
  });
});
