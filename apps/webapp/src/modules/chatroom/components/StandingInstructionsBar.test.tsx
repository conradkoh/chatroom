import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsBar } from './StandingInstructionsBar';

const mockUpsert = vi.fn();
const mockSetEnabled = vi.fn();
const mockClear = vi.fn();
const mockUseIsDesktop = vi.fn(() => true);
let mockQueryResult: { content: string; enabled: boolean } = { content: '', enabled: false };

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockQueryResult,
  useSessionMutation: (mutationName: string) => {
    if (mutationName === 'standingInstructions:upsert') return mockUpsert;
    if (mutationName === 'standingInstructions:setEnabled') return mockSetEnabled;
    if (mutationName === 'standingInstructions:clear') return mockClear;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    standingInstructions: {
      get: 'standingInstructions:get',
      upsert: 'standingInstructions:upsert',
      setEnabled: 'standingInstructions:setEnabled',
      clear: 'standingInstructions:clear',
    },
  },
}));

const mockUseKeyboardInset = vi.fn(() => 0);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => mockUseKeyboardInset(),
}));

const ROOM_ID = 'room1' as Id<'chatroom_rooms'>;

describe('StandingInstructionsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { content: '', enabled: false };
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('shows add button when no standing instructions', () => {
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
  });

  it('shows active bar with label and content', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Standing instructions')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
  });

  it('opens edit mode on add button click', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('Confirm button uses text-chatroom-text-on-accent not text-white', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('text-chatroom-text-on-accent');
    expect(confirmBtn.className).not.toContain('text-white');
  });

  it('Escape in textarea cancels edit without saving', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.clear(textarea);
    await user.type(textarea, 'changed');
    await user.keyboard('{Escape}');

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  describe('menu open and actions', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    });

    it('active bar does not show actions before click', () => {
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
      expect(screen.queryByText('Disable')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('opens popover on desktop with correct slot', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Disable')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('opens drawer on mobile with correct slot', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(false);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).toBeNull();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Disable')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('clicking Disable from menu calls setEnabled(false)', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Disable'));

      expect(mockSetEnabled).toHaveBeenCalledWith({ chatroomId: ROOM_ID, enabled: false });
    });

    it('clicking Delete from menu calls clear()', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Delete'));

      expect(mockClear).toHaveBeenCalledWith({ chatroomId: ROOM_ID });
    });

    it('clicking Edit from menu opens editing panel', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('Ctrl+Enter in textarea confirms and saves', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.clear(textarea);
    await user.type(textarea, 'updated instruction');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockUpsert).toHaveBeenCalledWith({
      chatroomId: ROOM_ID,
      content: 'updated instruction',
    });
  });
});
