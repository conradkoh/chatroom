import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLifecycleImpacts: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mocks.getLifecycleImpacts();
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'archive') return mocks.archive;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      getLifecycleImpacts: 'chatrooms.getLifecycleImpacts',
      archive: 'chatrooms.archive',
    },
  },
}));

describe('LifecycleConfirmDialog', () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    chatroomId: 'room-1' as any,
    action: 'archive' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders impact lines when impacts returned', async () => {
    mocks.getLifecycleImpacts.mockReturnValue({
      action: 'archive',
      impacts: [{ kind: 'scheduled_prompt', count: 2 }],
    });

    const { LifecycleConfirmDialog } = await import('./LifecycleConfirmDialog');
    render(<LifecycleConfirmDialog {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByText('2 scheduled prompts will be disabled')).toBeDefined();
      expect(screen.getByText('Archive this chat?')).toBeDefined();
    });
  });

  it('renders generic copy when impacts empty', async () => {
    mocks.getLifecycleImpacts.mockReturnValue({
      action: 'archive',
      impacts: [],
    });

    const { LifecycleConfirmDialog } = await import('./LifecycleConfirmDialog');
    render(<LifecycleConfirmDialog {...baseProps} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'This chat will be moved to the Completed tab. You can still view its history.'
        )
      ).toBeDefined();
    });
  });

  it('confirm calls archive mutation', async () => {
    mocks.getLifecycleImpacts.mockReturnValue({
      action: 'archive',
      impacts: [],
    });
    mocks.archive.mockResolvedValue({ success: true, disabledPromptCount: 0 });

    const { LifecycleConfirmDialog } = await import('./LifecycleConfirmDialog');
    render(<LifecycleConfirmDialog {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByText('Archive')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Archive'));

    await waitFor(() => {
      expect(mocks.archive).toHaveBeenCalledWith({ chatroomId: 'room-1' });
    });
  });

  it('cancel does not call archive', async () => {
    mocks.getLifecycleImpacts.mockReturnValue({
      action: 'archive',
      impacts: [],
    });

    const { LifecycleConfirmDialog } = await import('./LifecycleConfirmDialog');
    render(<LifecycleConfirmDialog {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Cancel'));
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
