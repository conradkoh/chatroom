import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileContentViewer } from './FileContentViewer';

vi.mock('../hooks/useRequestWorkspaceFileContent', () => ({
  useRequestWorkspaceFileContent: () => ({
    content: '',
    truncated: false,
  }),
}));

vi.mock('../file-renderers', () => ({
  isMarkdownFile: () => false,
  isCsvFile: () => false,
  SyntaxHighlighter: () => <pre data-testid="syntax-highlighter" />,
}));

vi.mock('../../components/FileSelector/binaryDetection', () => ({
  isBinaryFile: () => false,
}));

describe('FileContentViewer', () => {
  it('shows italic empty placeholder when file content is blank', () => {
    render(
      <FileContentViewer machineId="machine-1" workingDir="/workspace" filePath="notes.txt" />
    );

    const placeholder = screen.getByText('This file is empty.');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder.tagName).toBe('P');
    expect(placeholder.className).toContain('italic');
    expect(screen.queryByTestId('syntax-highlighter')).not.toBeInTheDocument();
  });
});
