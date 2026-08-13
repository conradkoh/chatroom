import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgenticQueryPanel } from './AgenticQueryPanel';
import { JUMP_TO_NEW_MESSAGES_Z_INDEX } from '../../components/timeline/timelineVirtualizerConfig';

import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '@/modules/chatroom/components/shared/industrialDialogStyles';

const mockSubmit = vi.fn();
const mockUseAgenticQuery = vi.fn();
const mockToSubmitSelection = vi.fn();

vi.mock('../hooks/useAgenticQuery', () => ({
  useAgenticQuery: (...args: unknown[]) => mockUseAgenticQuery(...args),
}));

vi.mock('../hooks/useAgenticQueryHarnessSelection', () => ({
  useAgenticQueryHarnessSelection: () => ({
    harnesses: [{ name: 'opencode-sdk', label: 'SDK', providers: [] }],
    harnessName: 'opencode-sdk',
    setHarnessName: vi.fn(),
    providers: [],
    selectedModel: '',
    setSelectedModel: vi.fn(),
    isModelHidden: undefined,
    selectionReady: true,
    toSubmitSelection: mockToSubmitSelection,
    isLoading: false,
    machineId: 'machine-1',
    filter: { isHidden: undefined, setFilter: vi.fn(), enabled: true },
    currentEntry: null,
    applyConfig: vi.fn(),
    favorites: [],
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    moveFavorite: vi.fn(),
    isFavorite: () => false,
    favoritesLoading: false,
  }),
}));

vi.mock('./AgenticQueryHarnessSync', () => ({
  AgenticQueryHarnessSync: () => null,
}));

vi.mock('../../direct-harness/hooks/useRefreshCapabilities', () => ({
  useRefreshCapabilities: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/modules/chatroom/workspace/files/useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: () => ({
    entries: [],
    refresh: vi.fn(),
    isLoading: false,
    hasTree: false,
  }),
}));

const mockScrollToBottom = vi.fn();
let mockIsPinned = true;

vi.mock('@/modules/chatroom/hooks/useScrollController', () => ({
  useScrollController: () => ({
    controller: {
      current: {
        attach: vi.fn(),
        detach: vi.fn(),
        onNewMessages: vi.fn(),
        snapToBottom: vi.fn(),
      },
    },
    isPinned: mockIsPinned,
    scrollToBottom: mockScrollToBottom,
    beginResize: vi.fn(),
    endResize: vi.fn(),
  }),
}));

const mockUseAgenticQueryRunTurnStore = vi.fn();
vi.mock('../hooks/useAgenticQueryRunTurnStore', () => ({
  useAgenticQueryRunTurnStore: (...args: unknown[]) => mockUseAgenticQueryRunTurnStore(...args),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('AgenticQueryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPinned = true;
    mockScrollToBottom.mockClear();
    mockSubmit.mockResolvedValue(undefined);
    mockToSubmitSelection.mockReturnValue({ harnessName: 'opencode-sdk' });
    mockUseAgenticQueryRunTurnStore.mockReturnValue({
      turns: [],
      streamingOverlay: null,
      isLoading: false,
    });
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'draft', mode: 'search', title: 'Agentic Search' },
      turns: [],
      isLoading: false,
      isNotFound: false,
      isRunning: false,
      isDraft: true,
      canFollowUp: false,
      canSubmit: true,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });
  });

  it('shows unavailable message and calls onUnavailable when query is not found', () => {
    const onUnavailable = vi.fn();
    mockUseAgenticQuery.mockReturnValue({
      query: undefined,
      turns: [],
      isLoading: false,
      isNotFound: true,
      isRunning: false,
      isDraft: false,
      canFollowUp: false,
      canSubmit: false,
      activeRunId: undefined,
      submit: mockSubmit,
    });

    render(
      <AgenticQueryPanel
        queryId="query-missing"
        mode="search"
        workspaceId="ws-1"
        onUnavailable={onUnavailable}
      />
    );

    expect(screen.getByTestId('agentic-query-unavailable')).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalled();
  });

  it('renders config bar for draft queries', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByTestId('agentic-query-config-bar')).toBeInTheDocument();
  });

  it('submits a draft query with harness selection', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/Search or ask about the codebase/i), {
      target: { value: 'find auth handlers' },
    });
    fireEvent.click(screen.getByTestId('agentic-query-submit'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('find auth handlers', {
        harnessName: 'opencode-sdk',
      });
    });
  });

  it('shows follow-up input when query can be refined', () => {
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'search', title: 'How auth works' },
      turns: [
        {
          _id: 'turn-1',
          seq: 0,
          userMessage: 'How auth works?',
          assistantResponse: '## Summary\n\nAuth uses sessions.',
          createdAt: 1,
        },
      ],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    expect(screen.getByTestId('agentic-query-follow-up')).toBeInTheDocument();
    expect(screen.getByText(/Auth uses sessions/i)).toBeInTheDocument();
    expect(screen.getByTestId('agentic-query-config-bar')).toBeInTheDocument();
  });

  it('renders turns in chronological order with newest at bottom', () => {
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'search', title: 'How auth works' },
      turns: [
        {
          _id: 'turn-1',
          seq: 0,
          userMessage: 'First question',
          assistantResponse: 'First answer',
          createdAt: 1,
        },
        {
          _id: 'turn-2',
          seq: 1,
          userMessage: 'Latest question',
          assistantResponse: 'Latest answer',
          createdAt: 2,
        },
      ],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const composer = screen.getByTestId('agentic-query-composer');
    const results = screen.getByTestId('agentic-query-results');
    const latestTurn = screen.getByTestId('agentic-query-latest-turn');
    const historyTurn = screen.getByTestId('agentic-query-history-turn');

    expect(
      results.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Oldest turn appears before newest in document order
    expect(
      historyTurn.compareDocumentPosition(latestTurn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Newest turn is last in results, directly above composer
    expect(
      latestTurn.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(latestTurn).toHaveTextContent('Latest question');
    expect(latestTurn).toHaveTextContent('Latest answer');
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('First question')).toBeInTheDocument();
  });

  it('shows collapsed thinking block while streaming reasoning tokens', () => {
    mockUseAgenticQueryRunTurnStore.mockReturnValue({
      turns: [],
      streamingOverlay: {
        turnId: 'turn-stream',
        textContent: '',
        reasoningContent: 'Let me search the codebase...',
      },
      isLoading: false,
    });

    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'running', mode: 'search', title: 'Search' },
      turns: [{ _id: 'turn-1', seq: 0, userMessage: 'find auth', createdAt: 1 }],
      isLoading: false,
      isRunning: true,
      isDraft: false,
      canFollowUp: false,
      canSubmit: false,
      activeRunId: 'run-1',
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.queryByText('Let me search the codebase...')).not.toBeInTheDocument();
  });

  it('shows jump to new messages button when scroll is unpinned', () => {
    mockIsPinned = false;
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'search', title: 'Test' },
      turns: [{ _id: 'turn-1', seq: 0, userMessage: 'q', assistantResponse: 'a', createdAt: 1 }],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    expect(screen.getByTestId('agentic-query-jump-to-new')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to new messages' })).toBeInTheDocument();
  });

  it('uses the shared content-overlay z-index for the jump chip', () => {
    mockIsPinned = false;
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    expect(screen.getByTestId('agentic-query-jump-to-new').style.zIndex).toBe(
      String(JUMP_TO_NEW_MESSAGES_Z_INDEX)
    );
  });

  it('hides jump to new messages button when pinned', () => {
    mockIsPinned = true;
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'search', title: 'Test' },
      turns: [{ _id: 'turn-1', seq: 0, userMessage: 'q', assistantResponse: 'a', createdAt: 1 }],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    expect(screen.queryByTestId('agentic-query-jump-to-new')).toBeNull();
  });

  it('calls scrollToBottom when jump button is clicked', async () => {
    mockIsPinned = false;
    const user = userEvent.setup();
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'search', title: 'Test' },
      turns: [{ _id: 'turn-1', seq: 0, userMessage: 'q', assistantResponse: 'a', createdAt: 1 }],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    await user.click(screen.getByRole('button', { name: 'Jump to new messages' }));
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('submits on Enter', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search or ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: false, ctrlKey: false });

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('find auth handlers', {
        harnessName: 'opencode-sdk',
      });
    });
  });

  it('does not submit on Cmd+Enter', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search or ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on Ctrl+Enter', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search or ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('renders a single-line composer by default', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByTestId('agentic-query-composer-input');
    expect(textarea).toHaveAttribute('rows', '1');
    expect(textarea.className).toContain('min-h-[2.5rem]');
    expect(textarea.className).not.toContain('min-h-[120px]');
  });

  it('sets single-line inline height on mount before user input', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByTestId('agentic-query-composer-input') as HTMLTextAreaElement;
    const inlineHeight = parseInt(textarea.style.height, 10);
    expect(inlineHeight).toBeGreaterThanOrEqual(40);
    expect(inlineHeight).toBeLessThanOrEqual(192);
    expect(inlineHeight).toBeLessThan(80);
  });

  it('does not render Search/Ask mode toggle', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.queryByText('Ask')).not.toBeInTheDocument();
    expect(screen.getByTestId('agentic-query-submit')).toHaveAttribute('aria-label', 'Search');
    expect(screen.getByTestId('agentic-query-submit').className).toContain('md:hidden');
  });

  describe('composer submit button regressions', () => {
    it('places the submit button inline with the composer input', () => {
      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      const textarea = screen.getByTestId('agentic-query-composer-input');
      const submitButton = screen.getByTestId('agentic-query-submit');
      const row = textarea.parentElement;

      expect(row).not.toBeNull();
      expect(row?.className).toContain('flex');
      expect(row?.contains(submitButton)).toBe(true);
      expect(textarea.className).toContain('flex-1');
    });

    it('uses industrial primary classes for the search submit button', () => {
      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      const submitButton = screen.getByTestId('agentic-query-submit');
      for (const token of chatroomIndustrialButtonPrimaryClassName.split(/\s+/)) {
        expect(submitButton.className).toContain(token);
      }
      expect(submitButton.className).not.toContain('text-white');
      expect(submitButton.className).toContain('text-chatroom-bg-primary');
    });

    it('uses industrial secondary classes for the follow-up submit button', () => {
      mockUseAgenticQuery.mockReturnValue({
        query: { status: 'complete', mode: 'search', title: 'How auth works' },
        turns: [
          {
            _id: 'turn-1',
            seq: 0,
            userMessage: 'How auth works?',
            assistantResponse: 'Auth uses sessions.',
            createdAt: 1,
          },
        ],
        isLoading: false,
        isRunning: false,
        isDraft: false,
        canFollowUp: true,
        canSubmit: false,
        harnessSessionId: undefined,
        submit: mockSubmit,
      });

      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      const followUpButton = screen.getByTestId('agentic-query-follow-up');
      for (const token of chatroomIndustrialButtonSecondaryClassName.split(/\s+/)) {
        expect(followUpButton.className).toContain(token);
      }
      expect(followUpButton).toHaveAttribute('aria-label', 'Follow up');
    });

    it('renders icon-only submit controls without visible button labels', () => {
      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      const submitButton = screen.getByTestId('agentic-query-submit');
      expect(submitButton).toHaveTextContent('');
      expect(submitButton.querySelector('svg')).toBeInTheDocument();
      expect(submitButton.querySelector('svg')?.classList.toString()).toContain('lucide-search');
    });

    it('does not render removed composer help text', () => {
      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      expect(screen.queryByText(/Type a query and submit to get started/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Enter to search/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/⌘Enter for new line/i)).not.toBeInTheDocument();
    });

    it('uses the concise search placeholder', () => {
      render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

      expect(screen.getByTestId('agentic-query-composer-input')).toHaveAttribute(
        'placeholder',
        'Search or ask about the codebase…'
      );
    });
  });

  it('shows failed status and summary', () => {
    mockUseAgenticQuery.mockReturnValue({
      query: {
        status: 'failed',
        mode: 'search',
        title: 'Agentic Search',
        summary: 'Agent produced no response',
      },
      turns: [{ _id: 't1', seq: 0, userMessage: 'find auth', createdAt: 1 }],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: true,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Agent produced no response')).toBeInTheDocument();
  });
});
