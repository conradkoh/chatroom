import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileContentViewer } from './FileContentViewer';
import { pendingOptimisticNewFilePaths } from '../hooks/pendingOptimisticNewFilePaths';
import { FILE_READ_ERROR_PLACEHOLDER } from '../utils/fileContentSentinels';

const mockUseRequestWorkspaceFileContent = vi.fn();

vi.mock('../hooks/useRequestWorkspaceFileContent', () => ({
  useRequestWorkspaceFileContent: () => mockUseRequestWorkspaceFileContent(),
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
  beforeEach(() => {
    pendingOptimisticNewFilePaths.clear();
    mockUseRequestWorkspaceFileContent.mockReturnValue({
      content: '',
      truncated: false,
    });
  });

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

  it('shows creating state instead of read error while optimistic create is pending', () => {
    pendingOptimisticNewFilePaths.add('notes.txt');
    mockUseRequestWorkspaceFileContent.mockReturnValue({
      content: FILE_READ_ERROR_PLACEHOLDER,
      encoding: 'utf8',
      truncated: false,
      fetchedAt: Date.now(),
    });

    render(
      <FileContentViewer machineId="machine-1" workingDir="/workspace" filePath="notes.txt" />
    );

    expect(screen.getByText('Creating file…')).toBeInTheDocument();
    expect(screen.queryByText(FILE_READ_ERROR_PLACEHOLDER)).not.toBeInTheDocument();
  });
});
