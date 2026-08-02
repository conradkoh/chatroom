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
let mockQueryResult: { content: string; enabled: boolean; title: string } | undefined = {
  content: '',
  enabled: false,
  title: '',
};
let mockHistory: {
  _id: string;
  content: string;
  title: string;
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
    mockQueryResult = { content: '', enabled: false, title: '' };
    mockHistory = [];
    mockUseIsDesktop.mockReturnValue(true);
    mockRecordUse.mockResolvedValue({ content: 'Always use TypeScript', title: 'Type safety' });
  });

  it('shows add button when no standing instructions', () => {
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
    expect(screen.getByTestId('standing-instructions-add-bar')).toBeInTheDocument();
  });

  it('shows loading placeholder while query is unresolved', () => {
    mockQueryResult = undefined;
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);

    const loading = screen.getByTestId('standing-instructions-bar-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Add standing instructions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders content bar after query resolves', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);

    expect(screen.queryByTestId('standing-instructions-bar-loading')).not.toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
  });

  it('shows active bar with label and content', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Standing instructions')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
  });

  it('shows disabled bar with label suffix and content', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: false, title: '' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Standing instructions (disabled)')).toBeInTheDocument();
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
    expect(screen.queryByText('Add standing instructions')).not.toBeInTheDocument();
  });

  it('opens add panel with history list on add button click', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    expect(screen.getAllByText('Standing Instructions').length).toBeGreaterThan(0);
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
    mockHistory = [
      {
        _id: 'h1',
        content: 'Always use TypeScript',
        title: 'Type safety',
        useCount: 10,
        lastUsedAt: 5000,
      },
    ];
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByText('Type safety'));
    await user.click(screen.getByText('Cancel'));

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
  });

  describe('menu open and actions — active state', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    });

    it('active bar does not show actions before click', () => {
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
      expect(screen.queryByText('Disable')).not.toBeInTheDocument();
      expect(screen.queryByText('Remove from chat')).not.toBeInTheDocument();
    });

    it('opens desktop actions in a pointer popover (not a modal dialog) and Disable present', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="chatroom-dialog-content"]')).toBeNull();
      expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
      expect(screen.getByText('Disable')).toBeInTheDocument();
      expect(screen.queryByText('Enable')).not.toBeInTheDocument();
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

    it('active bar carries the active-bar testid', () => {
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      expect(screen.getByTestId('standing-instructions-active-bar')).toBeInTheDocument();
      expect(screen.queryByTestId('standing-instructions-disabled-bar')).not.toBeInTheDocument();
    });

    it('clicking Disable calls setEnabled(false)', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Disable'));

      expect(mockSetEnabled).toHaveBeenCalledWith({ chatroomId: ROOM_ID, enabled: false });
    });

    it('clicking Remove from chat calls clear()', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Remove from chat'));

      expect(mockClear).toHaveBeenCalledWith({ chatroomId: ROOM_ID });
    });

    it('clicking Edit opens editing panel', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(document.querySelector('[data-slot="chatroom-dialog-content"]')).not.toBeNull();
      expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('clicking Edit does not show history section', async () => {
      const user = userEvent.setup();
      mockHistory = [
        {
          _id: 'h1',
          content: 'Use async/await',
          title: 'Async patterns',
          useCount: 5,
          lastUsedAt: 1000,
        },
        { _id: 'h2', content: 'Write tests', title: 'Tests', useCount: 3, lastUsedAt: 2000 },
      ];
      mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });
  });

  describe('menu open and actions — disabled with content', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: false, title: '' };
    });

    it('shows Enable instead of Disable in menu', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));

      expect(screen.getByText('Enable')).toBeInTheDocument();
      expect(screen.queryByText('Disable')).not.toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Remove from chat')).toBeInTheDocument();
    });

    it('clicking Enable calls setEnabled(true)', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));
      await user.click(screen.getByText('Enable'));

      expect(mockSetEnabled).toHaveBeenCalledWith({ chatroomId: ROOM_ID, enabled: true });
    });

    it('disabled bar carries the disabled-bar testid', () => {
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      expect(screen.getByTestId('standing-instructions-disabled-bar')).toBeInTheDocument();
      expect(screen.queryByTestId('standing-instructions-active-bar')).not.toBeInTheDocument();
    });
  });

  describe('history UI in add flow', () => {
    beforeEach(() => {
      mockHistory = [
        {
          _id: 'h1',
          content: 'Always use TypeScript',
          title: 'Type safety',
          useCount: 10,
          lastUsedAt: 5000,
        },
        {
          _id: 'h2',
          content: 'Write unit tests first',
          title: 'Tests first',
          useCount: 5,
          lastUsedAt: 4000,
        },
        {
          _id: 'h3',
          content: 'Use async/await patterns',
          title: 'Async patterns',
          useCount: 3,
          lastUsedAt: 3000,
        },
      ];
    });

    it('add flow with history shows titles, Create new, and View more', async () => {
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));

      expect(screen.getAllByText('Standing Instructions').length).toBeGreaterThan(0);
      expect(screen.getByText('Type safety')).toBeInTheDocument();
      expect(screen.getByText('Tests first')).toBeInTheDocument();
      expect(screen.getByText('Async patterns')).toBeInTheDocument();
      expect(screen.queryByText('Always use TypeScript')).not.toBeInTheDocument();
      expect(screen.queryByText('Write unit tests first')).not.toBeInTheDocument();
      expect(screen.getByTestId('standing-instructions-create-new')).toBeInTheDocument();
      expect(screen.getByText('View more')).toBeInTheDocument();
      expect(screen.queryByText('From history')).not.toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('selecting history then Confirm calls recordUse and upsert with title', async () => {
      const user = userEvent.setup();
      mockRecordUse.mockResolvedValue({ content: 'Write unit tests first', title: 'Tests first' });
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));
      await user.click(screen.getByText('Tests first'));
      await user.click(screen.getByText('Confirm'));

      expect(mockRecordUse).toHaveBeenCalledWith({ historyId: 'h2' });
      expect(mockUpsert).toHaveBeenCalledWith({
        chatroomId: ROOM_ID,
        content: 'Write unit tests first',
        title: 'Tests first',
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
      mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getByText('Edit'));

      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });
  });

  it('includes PickerPanelHeader in the actions menu', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));

    expect(screen.getAllByText('Standing instructions').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('uses larger action row classes on mobile', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));
    const edit = screen.getByText('Edit').closest('[role="option"]');
    expect(edit?.className).toContain('min-h-11');
    expect(edit?.className).toContain('text-sm');
  });

  it('keeps compact action rows on desktop', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
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
    expect(screen.getAllByText('Standing Instructions').length).toBeGreaterThan(0);
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('min-h-11');
    expect(confirmBtn.className).toContain('text-chatroom-text-on-accent');
  });

  it('aligns mobile add drawer list with header (no extra horizontal padding)', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(false);
    mockHistory = [
      {
        _id: 'h1',
        content: 'Always use TypeScript',
        title: 'Type safety',
        useCount: 10,
        lastUsedAt: 5000,
      },
    ];
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const body = screen.getByTestId('standing-instructions-mobile-add-body');
    expect(body.className).toContain('py-3');

    const list = body.querySelector('ul');
    expect(list?.className).toContain('w-full');
    expect(list?.querySelectorAll('[role="option"]')).toHaveLength(1);

    const createNewBtn = screen.getByTestId('standing-instructions-create-new');
    expect(createNewBtn.className).toContain('justify-center');
    expect(createNewBtn.className).toContain('bg-chatroom-status-success/5');
    expect(createNewBtn.className).toContain('min-h-11');
    expect(screen.queryByRole('option', { name: 'Create new' })).toBeNull();
  });

  it('places Create new button below list and above Confirm on add flow', async () => {
    const user = userEvent.setup();
    mockHistory = [
      {
        _id: 'h1',
        content: 'Always use TypeScript',
        title: 'Type safety',
        useCount: 10,
        lastUsedAt: 5000,
      },
    ];
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    const createNew = screen.getByTestId('standing-instructions-create-new');
    const confirm = screen.getByText('Confirm');
    const historyRow = screen.getByRole('option', { name: 'Type safety' });

    expect(
      historyRow.compareDocumentPosition(createNew) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      createNew.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('opens edit drawer on mobile when Edit is chosen from actions', async () => {
    const user = userEvent.setup();
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Standing instructions'));
    await user.click(screen.getByText('Edit'));

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByText('Confirm').className).toContain('min-h-11');
  });

  it('opens dialog on desktop Add (no add drawer)', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Standing Instructions').length).toBeGreaterThan(0);
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  });

  it('Create new reveals textarea and Ctrl+Enter confirms with title', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByTestId('standing-instructions-create-new'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.type(textarea, 'updated instruction');

    const titleInput = screen.getByPlaceholderText('Title');
    await user.type(titleInput, 'Update rule');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockUpsert).toHaveBeenCalledWith({
      chatroomId: ROOM_ID,
      content: 'updated instruction',
      title: 'Update rule',
    });
  });

  it('upsert called with title when user fills title in create flow', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByTestId('standing-instructions-create-new'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.type(textarea, 'test content');

    const titleInput = screen.getByPlaceholderText('Title');
    await user.type(titleInput, 'My Rule');

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockUpsert).toHaveBeenCalledWith({
      chatroomId: ROOM_ID,
      content: 'test content',
      title: 'My Rule',
    });
  });

  it('Confirm is disabled when content is filled but title is empty', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByTestId('standing-instructions-create-new'));

    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    await user.type(textarea, 'test content');

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('label span has hidden sm:inline class', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    const label = screen.getByText('Standing instructions');
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');
  });

  it('with title set shows title not full content', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: 'Team rules' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Team rules')).toBeInTheDocument();
    expect(screen.queryByText('Always use TypeScript')).not.toBeInTheDocument();
  });

  it('without title shows content fallback', () => {
    mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: '' };
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Always use TypeScript')).toBeInTheDocument();
  });
});
