import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateInviteCard } from './CreateInviteCard';

import { useIsMobile } from '@/hooks/useIsMobile';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

describe('CreateInviteCard', () => {
  const onCreate = vi.fn().mockResolvedValue({ code: 'ABC123' });

  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    onCreate.mockClear();
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
});
