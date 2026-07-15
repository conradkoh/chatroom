import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgenticQueryPanel } from './AgenticQueryPanel';

const mockSubmit = vi.fn();
const mockUpdateDraftMode = vi.fn();
const mockUseAgenticQuery = vi.fn();
const mockToSubmitSelection = vi.fn();

vi.mock('../hooks/useAgenticQuery', () => ({
  useAgenticQuery: (...args: unknown[]) => mockUseAgenticQuery(...args),
}));

vi.mock('../hooks/useAgenticQueryHarnessSelection', () => ({
  useAgenticQueryHarnessSelection: () => ({
    harnesses: [{ name: 'opencode-sdk', providers: [] }],
    harnessName: 'opencode-sdk',
    setHarnessName: vi.fn(),
    providers: [],
    selectedModel: '',
    setSelectedModel: vi.fn(),
    isModelHidden: undefined,
    selectionReady: true,
    toSubmitSelection: mockToSubmitSelection,
    isLoading: false,
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
    mockUpdateDraftMode.mockResolvedValue({ mode: 'ask', title: 'Agentic Ask' });
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
      updateDraftMode: mockUpdateDraftMode,
    });
  });

  it('renders harness controls for draft queries', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByTestId('agentic-query-harness-controls')).toBeInTheDocument();
  });

  it('submits a draft query with harness selection', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/Search the codebase/i), {
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
      query: { status: 'complete', mode: 'ask', title: 'How auth works' },
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
      updateDraftMode: mockUpdateDraftMode,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="ask" workspaceId="ws-1" />);

    expect(screen.getByTestId('agentic-query-follow-up')).toBeInTheDocument();
    expect(screen.getByText(/Auth uses sessions/i)).toBeInTheDocument();
    expect(screen.getByTestId('agentic-query-harness-controls')).toBeInTheDocument();
  });

  it('submits on Cmd+Enter', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('find auth handlers', {
        harnessName: 'opencode-sdk',
      });
    });
  });

  it('submits on Ctrl+Enter', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('find auth handlers', {
        harnessName: 'opencode-sdk',
      });
    });
  });

  it('does not submit on Enter alone', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    const textarea = screen.getByPlaceholderText(/Search the codebase/i);
    fireEvent.change(textarea, { target: { value: 'find auth handlers' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: false, ctrlKey: false });

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows ⌘Enter hint in submit section', () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByText(/⌘Enter to search/i)).toBeInTheDocument();
  });

  it('calls updateDraftMode when Ask is clicked', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    fireEvent.click(screen.getByText('Ask'));

    await waitFor(() => {
      expect(mockUpdateDraftMode).toHaveBeenCalledWith('ask');
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
      updateDraftMode: mockUpdateDraftMode,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Agent produced no response')).toBeInTheDocument();
  });
});
