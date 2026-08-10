import { describe, expect, it, vi } from 'vitest';

import AppPage from './page';

import { renderWithUser, screen } from '@/test-utils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/modules/chatroom', () => ({
  ChatroomSelector: () => <div data-testid="chatrooms-content" />,
  WorkspaceSelector: () => <div data-testid="workspaces-content" />,
}));

describe('AppPage', () => {
  it('renders chatrooms tab by default', () => {
    renderWithUser(<AppPage />);
    expect(screen.getByTestId('chatrooms-content')).toBeInTheDocument();
    expect(screen.queryByTestId('workspaces-content')).not.toBeInTheDocument();
  });

  it('switches to workspaces tab on click', async () => {
    const { user } = renderWithUser(<AppPage />);

    await user.click(screen.getByRole('tab', { name: 'Workspaces' }));

    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chatrooms-content')).not.toBeInTheDocument();
  });
});
