import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsBar } from './StandingInstructionsBar';

const mockUpsert = vi.fn();
const mockSetEnabled = vi.fn();
const mockUpdateHistory = vi.fn();
const mockDeleteHistory = vi.fn();
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
    if (mutationName === 'standingInstructions:updateHistory') return mockUpdateHistory;
    if (mutationName === 'standingInstructions:deleteHistory') return mockDeleteHistory;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    standingInstructions: {
      get: 'standingInstructions:get',
      upsert: 'standingInstructions:upsert',
      setEnabled: 'standingInstructions:setEnabled',
      updateHistory: 'standingInstructions:updateHistory',
      deleteHistory: 'standingInstructions:deleteHistory',
      listHistory: 'standingInstructions:listHistory',
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
  });

  it('shows add button when no standing instructions', () => {
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
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

  it('opens picker with history list on add button click', async () => {
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
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Standing instructions').length).toBeGreaterThan(0);
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.queryByText('View more')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();
  });

  it('Cancel in create modal closes without saving', async () => {
    const user = userEvent.setup();
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));
    await user.click(screen.getByTestId('standing-instructions-create-new'));
    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), 'draft content');
    await user.click(screen.getByText('Cancel'));

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(screen.getByText('Add standing instructions')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  describe('picker — active state with content', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: true, title: 'Type safety' };
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
          content: 'Use async/await',
          title: 'Async patterns',
          useCount: 8,
          lastUsedAt: 4000,
        },
      ];
    });

    it('opens picker on bar click without Edit actions menu', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('shows Active badge and Update when alternate is selected', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Update')).toBeDisabled();

      await user.click(screen.getByText('Async patterns'));
      expect(screen.getByText('Update')).not.toBeDisabled();
    });

    it('opens drawer on mobile', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(false);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));

      expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
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

    it('edit from picker calls updateHistory', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getAllByLabelText('Edit')[1]);
      await user.click(screen.getByText('Confirm'));

      expect(mockUpdateHistory).toHaveBeenCalledWith({
        historyId: 'h2',
        content: 'Use async/await',
        title: 'Async patterns',
        applyToOwnerChatrooms: false,
      });
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('edit active match also calls upsert', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getAllByLabelText('Edit')[0]);
      await user.click(screen.getByText('Confirm'));

      expect(mockUpdateHistory).toHaveBeenCalledWith({
        historyId: 'h1',
        content: 'Always use TypeScript',
        title: 'Type safety',
        applyToOwnerChatrooms: false,
      });
      expect(mockUpsert).toHaveBeenCalledWith({
        chatroomId: ROOM_ID,
        content: 'Always use TypeScript',
        title: 'Type safety',
      });
    });

    it('delete calls deleteHistory only', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions'));
      await user.click(screen.getAllByLabelText('Delete')[1]);
      await user.click(screen.getByText('Delete'));

      expect(mockDeleteHistory).toHaveBeenCalledWith({ historyId: 'h2' });
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('picker — disabled with content', () => {
    beforeEach(() => {
      mockQueryResult = { content: 'Always use TypeScript', enabled: false, title: '' };
      mockHistory = [
        {
          _id: 'h1',
          content: 'Always use TypeScript',
          title: '',
          useCount: 10,
          lastUsedAt: 5000,
        },
        {
          _id: 'h2',
          content: 'Use async/await',
          title: 'Async patterns',
          useCount: 8,
          lastUsedAt: 4000,
        },
      ];
    });

    it('shows Enable only when no selection is pending', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));

      expect(screen.getByText('Enable')).toBeInTheDocument();
      expect(screen.queryByText('Disable')).not.toBeInTheDocument();
      expect(screen.getByText('Apply')).toBeDisabled();
    });

    it('shows Apply when an item is selected', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));
      await user.click(screen.getByText('Async patterns'));

      expect(screen.queryByText('Enable')).not.toBeInTheDocument();
      expect(screen.getByText('Apply')).not.toBeDisabled();
    });

    it('clicking Apply upserts with display title for legacy empty title', async () => {
      const user = userEvent.setup();
      mockUseIsDesktop.mockReturnValue(true);
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Standing instructions (disabled)'));
      await user.click(screen.getByText('Async patterns'));
      await user.click(screen.getByText('Apply'));

      expect(mockUpsert).toHaveBeenCalledWith({
        chatroomId: ROOM_ID,
        content: 'Use async/await',
        title: 'Async patterns',
      });
    });
  });

  describe('history UI in add flow', () => {
    beforeEach(() => {
      mockHistory = Array.from({ length: 9 }, (_, index) => ({
        _id: `h${index + 1}`,
        content: `Content ${index + 1}`,
        title: `Title ${index + 1}`,
        useCount: 10 - index,
        lastUsedAt: 5000 - index * 100,
      }));
    });

    it('add flow with history shows titles, Create new, and View more', async () => {
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));

      expect(screen.getAllByText('Standing instructions').length).toBeGreaterThan(0);
      expect(screen.getByText('Title 1')).toBeInTheDocument();
      expect(screen.getByText('Title 2')).toBeInTheDocument();
      expect(screen.getByText('Title 3')).toBeInTheDocument();
      expect(screen.getByTestId('standing-instructions-create-new')).toBeInTheDocument();
      expect(screen.getByText('View more')).toBeInTheDocument();
      expect(screen.queryByText('From history')).not.toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(8);
    });

    it('selecting history then Apply calls upsert only', async () => {
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));
      await user.click(screen.getByText('Title 2'));
      await user.click(screen.getByText('Apply'));

      expect(mockUpsert).toHaveBeenCalledWith({
        chatroomId: ROOM_ID,
        content: 'Content 2',
        title: 'Title 2',
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

    it('empty history still shows Create new without View more', async () => {
      mockHistory = [];
      const user = userEvent.setup();
      render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
      await user.click(screen.getByText('Add standing instructions'));

      expect(screen.getByText('Create new')).toBeInTheDocument();
      expect(screen.queryByText('View more')).not.toBeInTheDocument();
      expect(screen.queryByText('From history')).not.toBeInTheDocument();
    });
  });

  it('opens picker drawer on mobile when Add is clicked', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(false);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(screen.getAllByText('Standing instructions').length).toBeGreaterThan(0);
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('aligns mobile picker list with header and create button styling', async () => {
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

    const drawer = document.querySelector('[data-slot="drawer-content"]');
    const list = drawer?.querySelector('ul');
    expect(list?.className).toContain('w-full');
    expect(list?.querySelectorAll('[role="option"]')).toHaveLength(1);

    const createNewBtn = screen.getByTestId('standing-instructions-create-new');
    expect(createNewBtn.className).toContain('justify-center');
    expect(createNewBtn.className).not.toContain('border-t');
    expect(createNewBtn.className).toContain('hover:bg-chatroom-bg-hover');
    expect(createNewBtn.className).toContain('text-xs font-bold uppercase tracking-wider');
    expect(createNewBtn.className).not.toContain('bg-chatroom-status-success');
    expect(createNewBtn.className).not.toContain('min-h-11');
    expect(screen.queryByRole('option', { name: 'Create new' })).toBeNull();
  });

  it('places Create new button below list and above footer Apply', async () => {
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
    const apply = screen.getByText('Apply');
    const historyRow = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('Type safety'));
    expect(historyRow).toBeDefined();

    expect(
      historyRow!.compareDocumentPosition(createNew) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      createNew.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('opens picker dialog on desktop Add', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<StandingInstructionsBar chatroomId={ROOM_ID} />);
    await user.click(screen.getByText('Add standing instructions'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Standing instructions').length).toBeGreaterThan(0);
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

  it('Confirm is disabled when content is filled but title is empty in create modal', async () => {
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
