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
  it('shows the import button next to + New', () => {
    render(<ChatroomSelectorHeader onCreate={vi.fn()} />);

    const importButton = screen.getByTestId('import-open-header');
    expect(importButton).toBeInTheDocument();
    expect(importButton).toHaveTextContent('Import');
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument();
  });
});

describe('ChatroomSelector empty state', () => {
  it('offers import from file under Create New Chatroom', () => {
    render(<ChatroomSelector onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Create New Chatroom' })).toBeInTheDocument();
    expect(screen.getByTestId('import-open-empty')).toBeInTheDocument();
  });
});
