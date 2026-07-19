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

  it('clicking active bar opens popover on desktop', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };

    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('clicking active bar opens drawer on mobile', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(false);
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };

    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
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
