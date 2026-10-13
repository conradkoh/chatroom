import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomSelector } from './ChatroomSelector';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  listing: {
    chatrooms: undefined as ChatroomWithStatus[] | undefined,
    statuses: new Map(),
    isLoading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, back: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('../hooks/useChatroomListingStatuses', () => ({
  useChatroomListingStatuses: () => mocks.listing,
}));

vi.mock('../hooks/useChatroomStatus', () => ({
  useChatroomStatus: () => ({ status: undefined }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

// The menu is covered by its own component; here it only needs to render its trigger.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children, ...props }: { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./LifecycleConfirmDialog', () => ({
  LifecycleConfirmDialog: () => null,
}));

function chatroom(id: string, name: string): ChatroomWithStatus {
  return {
    _id: id,
    _creationTime: 1,
    status: 'active',
    name,
    teamName: 'Duo',
    isFavorite: false,
    hasUnread: false,
    hasUnreadHandoff: false,
  } as ChatroomWithStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listing = { chatrooms: undefined, statuses: new Map(), isLoading: false };
});

describe('ChatroomSelector browser', () => {
  it('renders each chatroom name', () => {
    mocks.listing.chatrooms = [chatroom('room-a', 'Alpha room'), chatroom('room-b', 'Beta room')];
    render(<ChatroomSelector onSelect={vi.fn()} />);

    expect(screen.getByText('Alpha room')).toBeTruthy();
    expect(screen.getByText('Beta room')).toBeTruthy();
  });

  it('narrows the list as the user searches', () => {
    mocks.listing.chatrooms = [chatroom('room-a', 'Alpha room'), chatroom('room-b', 'Beta room')];
    render(<ChatroomSelector onSelect={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Search chatrooms...'), {
      target: { value: 'alpha' },
    });

    expect(screen.getByText('Alpha room')).toBeTruthy();
    expect(screen.queryByText('Beta room')).toBeNull();
  });

  it('names an unnamed chatroom Chatroom', () => {
    const unnamed = { ...chatroom('room-unnamed', ''), teamName: undefined } as ChatroomWithStatus;
    mocks.listing.chatrooms = [unnamed];
    render(<ChatroomSelector onSelect={vi.fn()} />);

    expect(screen.getByText('Chatroom')).toBeTruthy();
    expect(screen.queryByText('Team')).toBeNull();
  });

  it('renders the empty state when there are no chatrooms', () => {
    mocks.listing.chatrooms = [];
    render(<ChatroomSelector onSelect={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create New Chatroom' })).toBeTruthy();
  });

  it('opens the new chatroom wizard from "+ New"', () => {
    mocks.listing.chatrooms = [chatroom('room-a', 'Alpha room')];
    render(<ChatroomSelector onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));

    expect(mocks.push).toHaveBeenCalledWith('/app?create=true');
  });
});
