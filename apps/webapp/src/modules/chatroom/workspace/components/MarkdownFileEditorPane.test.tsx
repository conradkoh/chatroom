import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownFileEditorPane } from './MarkdownFileEditorPane';

type MarkdownEditorMockState = {
  content: string;
  setContent: typeof mockSetContent;
  isDirty: boolean;
  contentRef: { current: string };
  save: typeof mockSave;
  saving: boolean;
  error: string | null;
  isLoading: boolean;
};

const mockSave = vi.fn();
const mockSetContent = vi.fn();
const mockPurgeFileContentEntry = vi.fn().mockResolvedValue(undefined);
const contentRef = { current: '# Hello' };

const defaultMarkdownEditorState: MarkdownEditorMockState = {
  content: '# Hello',
  setContent: mockSetContent,
  isDirty: true,
  contentRef,
  save: mockSave,
  saving: false,
  error: null,
  isLoading: false,
};

const mockUseMarkdownFileEditor = vi.fn((): MarkdownEditorMockState => defaultMarkdownEditorState);

vi.mock('../hooks/useMarkdownFileEditor', () => ({
  useMarkdownFileEditor: () => mockUseMarkdownFileEditor(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockPurgeFileContentEntry,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      purgeFileContentEntryV2: 'purgeFileContentEntryV2',
    },
  },
}));

describe('MarkdownFileEditorPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPurgeFileContentEntry.mockResolvedValue(undefined);
    mockUseMarkdownFileEditor.mockReturnValue(defaultMarkdownEditorState);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows dirty indicator in toolbar', () => {
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    expect(screen.getByText(/readme\.md \*/)).toBeInTheDocument();
  });

  it('calls save on Cmd+S when textarea is focused', async () => {
    const user = userEvent.setup();
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    const textarea = screen.getByRole('textbox', { name: /edit docs\/readme\.md/i });
    await user.click(textarea);
    await user.keyboard('{Meta>}s{/Meta}');

    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('shows empty-file placeholder when content is blank', () => {
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: '' },
      save: mockSave,
      saving: false,
      error: null,
      isLoading: false,
    });

    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/empty.md"
      />
    );

    expect(screen.getByPlaceholderText('This file is empty.')).toBeInTheDocument();
  });

  it('shows workspace registration error instead of placeholder content in the editor', () => {
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: '' },
      save: mockSave,
      saving: false,
      error: 'Workspace is not registered on this machine.',
      isLoading: false,
    });

    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/Users/alice/chatroom/"
        filePath="README.md"
      />
    );

    expect(screen.getByText('Workspace is not registered on this machine.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /edit README\.md/i })).toHaveValue('');
  });

  it('dismisses workspace registration error via per-file purge mutation', async () => {
    const user = userEvent.setup();
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: '' },
      save: mockSave,
      saving: false,
      error: 'Workspace is not registered on this machine.',
      isLoading: false,
    });

    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/Users/alice/chatroom/"
        filePath="README.md"
      />
    );

    await user.click(screen.getByRole('button', { name: /dismiss error/i }));

    await waitFor(() => {
      expect(mockPurgeFileContentEntry).toHaveBeenCalledWith({
        machineId: 'machine-1',
        workingDir: '/Users/alice/chatroom/',
        filePath: 'README.md',
      });
    });
  });

  it('does not show dismiss control for non-registration errors', () => {
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: '' },
      save: mockSave,
      saving: false,
      error: 'File not found.',
      isLoading: false,
    });

    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/Users/alice/chatroom/"
        filePath="README.md"
      />
    );

    expect(screen.getByText('File not found.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss error/i })).not.toBeInTheDocument();
  });

  it('copies markdown and flips the header icon to a check for 2 s', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy as markdown/i });

    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith('# Hello');
    expect(copyButton.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.queryByTestId('markdown-pane-feedback')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButton.querySelector('svg.lucide-check')).toBeNull();
  });

  it('shows a copy failure in the markdown pane slot', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy as markdown/i });
    await user.click(copyButton);

    const slot = await screen.findByTestId('markdown-pane-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to copy markdown');
    expect(copyButton.querySelector('svg.lucide-check')).toBeNull();
    expect(writeText).toHaveBeenCalledWith('# Hello');
  });

  it('clears only a copy failure when a later copy succeeds', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy as markdown/i });
    await user.click(copyButton);
    expect(await screen.findByTestId('markdown-pane-feedback')).toHaveTextContent(
      'Failed to copy markdown'
    );

    writeText.mockResolvedValue(undefined);
    await user.click(copyButton);

    await waitFor(() => {
      expect(screen.queryByTestId('markdown-pane-feedback')).toBeNull();
    });
  });

  it('keeps a dismiss failure after a later copy succeeds', async () => {
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: '' },
      save: mockSave,
      saving: false,
      error: 'Workspace is not registered on this machine.',
      isLoading: false,
    });
    mockPurgeFileContentEntry.mockRejectedValue(new Error('purge failed'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/Users/alice/chatroom/"
        filePath="README.md"
      />
    );

    await user.click(screen.getByRole('button', { name: /dismiss error/i }));

    expect(await screen.findByTestId('markdown-pane-feedback')).toHaveTextContent(
      'Could not dismiss workspace registration error'
    );

    await user.click(screen.getByRole('button', { name: /copy as markdown/i }));

    expect(screen.getByTestId('markdown-pane-feedback')).toHaveTextContent(
      'Could not dismiss workspace registration error'
    );
  });

  it('highlights other exact matches when text is selected', async () => {
    mockUseMarkdownFileEditor.mockReturnValue({
      content: 'foo bar foo',
      setContent: mockSetContent,
      isDirty: false,
      contentRef: { current: 'foo bar foo' },
      save: mockSave,
      saving: false,
      error: null,
      isLoading: false,
    });

    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    const textarea = screen.getByRole('textbox', {
      name: /edit docs\/readme\.md/i,
    }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 3);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));

    await waitFor(() => {
      const marks = document.querySelectorAll('.selection-match-highlight');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('foo');
    });
  });
});
