import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSelectorModal } from './FileSelectorModal';

const mockCloseDialog = vi.fn();
const mockGetFileSelectorOpen = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportOffsetTop: vi.fn(() => 0),
}));

vi.mock('@/modules/chatroom/context/CommandDialogContext', () => ({
  useCommandDialogActions: () => ({ closeDialog: mockCloseDialog }),
}));

vi.mock('@/modules/chatroom/context/contextManagedDialogsController', () => ({
  getFileSelectorOpen: () => mockGetFileSelectorOpen(),
  openContextManagedDialog: vi.fn(),
  subscribeActiveContextManagedDialog: (callback: () => void) => {
    callback();
    return () => {};
  },
}));

vi.mock('@/modules/chatroom/hooks/useCommandDialogShortcut', () => ({
  useCommandDialogShortcut: vi.fn(),
}));

describe('FileSelectorModal', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const renderModal = (props: Partial<React.ComponentProps<typeof FileSelectorModal>> = {}) =>
    render(<FileSelectorModal files={[]} onSelectFile={vi.fn()} hasWorkspace {...props} />);

  it('shows load error with retry button', async () => {
    const onRefresh = vi.fn();
    renderModal({ loadError: 'File tree sync timed out', onRefresh });

    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('shows never-synced state with sync button', async () => {
    const onRefresh = vi.fn();
    renderModal({ isNeverSynced: true, onRefresh });

    expect(screen.getByText(/haven't synced yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    expect(onRefresh).toHaveBeenCalledWith();
  });

  it('shows the syncing state while a pending request is active', () => {
    renderModal({ isSyncing: true });

    expect(screen.getByText('SYNCING FILE TREE...')).toBeInTheDocument();
  });
});
