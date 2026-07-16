import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgenticQueryPanel } from './AgenticQueryPanel';

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

vi.mock('@/modules/chatroom/direct-harness/hooks/useHarnessTurnStore', () => ({
  useHarnessTurnStore: () => ({
    turns: [],
    streamingOverlay: null,
    isLoading: false,
  }),
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
    mockSubmit.mockResolvedValue(undefined);
    mockToSubmitSelection.mockReturnValue({ harnessName: 'opencode-sdk' });
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'draft', mode: 'search', title: 'Agentic Search' },
      turns: [],
      isLoading: false,
      isRunning: false,
      isDraft: true,
      canFollowUp: false,
      canSubmit: true,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });
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

  it('keeps the composer above results with latest response directly below', () => {
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

    expect(
      composer.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(latestTurn).toHaveTextContent('Latest question');
    expect(latestTurn).toHaveTextContent('Latest answer');
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('First question')).toBeInTheDocument();
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

  it('shows Enter keyboard hint in submit section', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByText(/Enter to search/i)).toBeInTheDocument();
    expect(screen.getByText(/⌘Enter for new line/i)).toBeInTheDocument();
  });

  it('does not render Search/Ask mode toggle', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.queryByText('Ask')).not.toBeInTheDocument();
    expect(screen.getByTestId('agentic-query-submit')).toHaveTextContent('Search');
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
