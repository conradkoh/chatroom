import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('MarkdownFileEditorPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMarkdownFileEditor.mockReturnValue(defaultMarkdownEditorState);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
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

  it('copies markdown when Copy button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    await user.click(screen.getByRole('button', { name: /copy as markdown/i }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied markdown to clipboard');
    });
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
