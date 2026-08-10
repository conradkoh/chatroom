import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppPage from './page';

import { renderWithUser, screen } from '@/test-utils';

const { mockPush, mockReplace, searchParamsStore } = vi.hoisted(() => {
  let value = new URLSearchParams();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    mockPush: vi.fn(),
    mockReplace: vi.fn((url: string) => {
      const queryIndex = url.indexOf('?');
      const query = queryIndex >= 0 ? url.slice(queryIndex + 1) : '';
      value = new URLSearchParams(query);
      emit();
    }),
    searchParamsStore: {
      getValue: () => value,
      setValue: (next: URLSearchParams) => {
        value = next;
        emit();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () =>
    useSyncExternalStore(
      searchParamsStore.subscribe,
      searchParamsStore.getValue,
      searchParamsStore.getValue
    ),
}));

vi.mock('@/modules/chatroom', () => ({
  ChatroomSelector: () => <div data-testid="chatrooms-content" />,
  WorkspaceSelector: () => <div data-testid="workspaces-content" />,
}));

describe('AppPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    searchParamsStore.setValue(new URLSearchParams());
  });

  it('renders chatrooms tab by default', () => {
    renderWithUser(<AppPage />);
    expect(screen.getByTestId('chatrooms-content')).toBeInTheDocument();
    expect(screen.queryByTestId('workspaces-content')).not.toBeInTheDocument();
  });

  it('switches to workspaces tab on click', async () => {
    const { user } = renderWithUser(<AppPage />);

    await user.click(screen.getByRole('tab', { name: 'Workspaces' }));

    expect(mockReplace).toHaveBeenCalledWith('/app?tab=workspaces');
    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chatrooms-content')).not.toBeInTheDocument();
  });

  it('renders workspaces tab when URL has ?tab=workspaces', () => {
    searchParamsStore.setValue(new URLSearchParams('?tab=workspaces'));

    renderWithUser(<AppPage />);

    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chatrooms-content')).not.toBeInTheDocument();
  });

  it('deletes the tab param when switching back to chatrooms', async () => {
    searchParamsStore.setValue(new URLSearchParams('?tab=workspaces'));
    const { user } = renderWithUser(<AppPage />);

    await user.click(screen.getByRole('tab', { name: 'Chatrooms' }));

    expect(mockReplace).toHaveBeenCalledWith('/app');
    expect(screen.getByTestId('chatrooms-content')).toBeInTheDocument();
  });

  it('falls back to chatrooms tab for invalid ?tab value', () => {
    searchParamsStore.setValue(new URLSearchParams('?tab=banana'));

    renderWithUser(<AppPage />);

    expect(screen.getByTestId('chatrooms-content')).toBeInTheDocument();
    expect(screen.queryByTestId('workspaces-content')).not.toBeInTheDocument();
  });

  it('preserves existing query params when switching tabs', async () => {
    searchParamsStore.setValue(new URLSearchParams('?create=true'));
    const { user } = renderWithUser(<AppPage />);

    await user.click(screen.getByRole('tab', { name: 'Workspaces' }));

    expect(mockReplace).toHaveBeenCalledWith('/app?create=true&tab=workspaces');
    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
  });
});
