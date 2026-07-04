import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownFileEditorPane } from './MarkdownFileEditorPane';

const mockSave = vi.fn();
const mockSetContent = vi.fn();
const contentRef = { current: '# Hello' };

const mockUseMarkdownFileEditor = vi.fn(() => ({
  content: '# Hello',
  setContent: mockSetContent,
  isDirty: true,
  contentRef,
  save: mockSave,
  saving: false,
  error: null,
  isLoading: false,
}));

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
    mockUseMarkdownFileEditor.mockReturnValue({
      content: '# Hello',
      setContent: mockSetContent,
      isDirty: true,
      contentRef,
      save: mockSave,
      saving: false,
      error: null,
      isLoading: false,
    });
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

  it('copies markdown when Copy button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MarkdownFileEditorPane
        machineId="machine-1"
        workingDir="/workspace"
        filePath="docs/readme.md"
      />
    );

    await user.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied markdown to clipboard');
    });
  });
});
