import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatroomSelectorHeader } from './ChatroomSelectorChrome';
import { ChatroomSelector } from '../ChatroomSelector';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../hooks/useChatroomListingStatuses', () => ({
  useChatroomListingStatuses: () => ({ chatrooms: [], statuses: new Map(), isLoading: false }),
}));

vi.mock('../../features/new-chatroom/NewChatroomWizard', () => ({
  NewChatroomWizard: () => null,
}));

describe('ChatroomSelectorHeader', () => {
  it('shows only the + New action, with no import entry point', () => {
    render(<ChatroomSelectorHeader onCreate={vi.fn()} />);

    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
    expect(screen.queryByTestId('import-open-header')).toBeNull();
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
  });
});

describe('ChatroomSelector empty state', () => {
  it('offers Create New Chatroom only, with no import entry point', () => {
    render(<ChatroomSelector onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Create New Chatroom' })).toBeInTheDocument();
    expect(screen.queryByTestId('import-open-empty')).toBeNull();
    expect(screen.queryByText('Import from file')).toBeNull();
  });
});
