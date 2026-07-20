import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsBar } from './StandingInstructionsBar';

const mockUpsert = vi.fn();
const mockSetEnabled = vi.fn();
const mockClear = vi.fn();
const mockRecordUse = vi.fn();
const mockUseIsDesktop = vi.fn(() => true);
let mockQueryResult: { content: string; enabled: boolean } = { content: '', enabled: false };
let mockHistory: {
  _id: string;
  content: string;
  useCount: number;
  lastUsedAt: number;
}[] = [];

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (queryName: unknown) => {
    if (queryName === 'standingInstructions:listHistory') return mockHistory;
    return mockQueryResult;
  },
  useSessionMutation: (mutationName: string) => {
    if (mutationName === 'standingInstructions:upsert') return mockUpsert;
    if (mutationName === 'standingInstructions:setEnabled') return mockSetEnabled;
    if (mutationName === 'standingInstructions:clear') return mockClear;
    if (mutationName === 'standingInstructions:recordUse') return mockRecordUse;
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
      listHistory: 'standingInstructions:listHistory',
      recordUse: 'standingInstructions:recordUse',
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
    mockHistory = [];
    mockUseIsDesktop.mockReturnValue(true);
    mockRecordUse.mockResolvedValue({ content: 'Always use TypeScript' });
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

  it('shows disabled bar with label suffix and content', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: false };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Standing instructions (disabled)')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
    expect(screen.queryByText('Add standing instructions')).not.toBeInTheDocument();
  });

  it('opens add panel with history list on add button click', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    expect(screen.getByText('Standing Instructions')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('View more')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();
  });

  it('Confirm button uses text-chatroom-text-on-accent not text-white', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('text-chatroom-text-on-accent');
    expect(confirmBtn.className).not.toContain('text-white');
  });

  it('Cancel in add panel closes without saving', async () => {
    const user = userEvent.setup();
    mockHistory = [{ _id: 'h1', content: 'Always use TypeScript', useCount: 10, lastUsedAt: 5000 }];
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByText('Always use TypeScript'));
    await user.click(screen.getByText('Cancel'));

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
  });

  describe('menu open and actions — active state', () => {
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

    it('opens popover on desktop with correct slot and Disable present', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
      expect(screen.getByText('Disable')).toBeInTheDocument();
      expect(screen.queryByText('Enable')).not.toBeInTheDocument();
      // anchorToPointer renders the pointer anchor on desktop
      expect(document.querySelector('[data-testid="picker-pointer-anchor"]')).toBeInTheDocument();
    });

    it('opens drawer on mobile with correct slot', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(false);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).toBeNull();
      expect(screen.getByText('Disable')).toBeInTheDocument();
    });

    it('clicking Disable calls setEnabled(false)', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Disable'));

      expect(mockSetEnabled).toHaveBeenCalledWith({ chatroomId: ROOM_ID, enabled: false });
    });

    it('clicking Delete calls clear()', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Delete'));

      expect(mockClear).toHaveBeenCalledWith({ chatroomId: ROOM_ID });
    });

    it('clicking Edit opens editing panel', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('clicking Edit does not show history section', async () => {
      const user = userEvent.setup();
      mockHistory = [
        { _id: 'h1', content: 'Use async/await', useCount: 5, lastUsedAt: 1000 },
        { _id: 'h2', content: 'Write tests', useCount: 3, lastUsedAt: 2000 },
      ];
      mockQueryResult = { content: 'Always use TypeScript', enabled: true };
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });
  });

  describe('menu open and actions — disabled with content', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: false };
    });

    it('shows Enable instead of Disable in menu', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));

      expect(screen.getByText('Enable')).toBeInTheDocument();
      expect(screen.queryByText('Disable')).not.toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('clicking Enable calls setEnabled(true)', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));
      await user.click(screen.getByText('Enable'));

      expect(mockSetEnabled).toHaveBeenCalledWith({ chatroomId: ROOM_ID, enabled: true });
    });
  });

  describe('history UI in add flow', () => {
    beforeEach(() => {
      mockHistory = [
        { _id: 'h1', content: 'Always use TypeScript', useCount: 10, lastUsedAt: 5000 },
        { _id: 'h2', content: 'Write unit tests first', useCount: 5, lastUsedAt: 4000 },
        { _id: 'h3', content: 'Use async/await patterns', useCount: 3, lastUsedAt: 3000 },
      ];
    });

    it('add flow with history shows top 3, Create new, and View more', async () => {
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));

      expect(screen.getByText('Standing Instructions')).toBeInTheDocument();
      expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
      expect(screen.getByText('Write unit tests first')).toBeInTheDocument();
      expect(screen.getByText('Use async/await patterns')).toBeInTheDocument();
      expect(screen.getByText('Create new')).toBeInTheDocument();
      expect(screen.getByText('View more')).toBeInTheDocument();
      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });

    it('selecting history then Confirm calls recordUse and upsert', async () => {
      const user = userEvent.setup();
      mockRecordUse.mockResolvedValue({ content: 'Write unit tests first' });
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));
      await user.click(screen.getByText('Write unit tests first'));
      await user.click(screen.getByText('Confirm'));

      expect(mockRecordUse).toHaveBeenCalledWith({ historyId: 'h2' });
      expect(mockUpsert).toHaveBeenCalledWith({
        chatroomId: ROOM_ID,
        content: 'Write unit tests first',
      });
    });

    it('View more opens history picker with search', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));
      await user.click(screen.getByText('View more'));

      expect(screen.getByPlaceholderText('Search history…')).toBeInTheDocument();
    });

    it('empty history still shows Create new and View more', async () => {
      mockHistory = [];
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));

      expect(screen.getByText('Create new')).toBeInTheDocument();
      expect(screen.getByText('View more')).toBeInTheDocument();
      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });

    it('does not show history section when editing existing content', async () => {
      const user = userEvent.setup();
      mockQueryResult = { content: 'Existing instruction', enabled: true };
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });
  });

  it('includes PickerPanelHeader in the actions menu', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));

    expect(screen.getAllByText('Standing instructions').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('uses larger action row classes on mobile', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));
    const edit = screen.getByText('Edit').closest('[role="option"]');
    expect(edit?.className).toContain('min-h-11');
    expect(edit?.className).toContain('text-sm');
  });

  it('keeps compact action rows on desktop', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));
    const edit = screen.getByText('Edit').closest('[role="option"]');
    expect(edit?.className).not.toContain('min-h-11');
  });

  it('opens add drawer on mobile when Add is clicked', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getByText('Standing Instructions')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('min-h-11');
    expect(confirmBtn.className).toContain('text-chatroom-text-on-accent');
  });

  it('opens edit drawer on mobile when Edit is chosen from actions', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true };
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));
    await user.click(screen.getByText('Edit'));

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByText('Confirm').className).toContain('min-h-11');
  });

  it('keeps inline AddingPanel on desktop Add (no add drawer)', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    expect(screen.getByText('Standing Instructions')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  });

  it('applies vertical padding to desktop AddingPanel chrome', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const panel = screen.getByTestId('standing-instructions-adding-panel');
    expect(panel.className).toContain('py-1.5');
    expect(panel.className).toContain('px-3');
  });

  it('Create new reveals textarea and Ctrl+Enter confirms', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByText('Create new'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.type(textarea, 'updated instruction');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockUpsert).toHaveBeenCalledWith({
      chatroomId: ROOM_ID,
      content: 'updated instruction',
    });
  });
});
