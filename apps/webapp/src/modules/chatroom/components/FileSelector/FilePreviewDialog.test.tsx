import { gzipSync } from 'node:zlib';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilePreviewDialog } from './FilePreviewDialog';
import { exportFileAsDocx } from '../../lib/messageExport';

const mockUseSessionQuery = vi.hoisted(() => vi.fn());
const mockRequestContent = vi.hoisted(() => vi.fn());

vi.mock('../../lib/messageExport', async () => {
  const formats = (await vi.importActual('../../lib/messageExport/downloadFormats')) as Record<
    string,
    unknown
  >;
  return {
    ...formats,
    saveTextFile: vi.fn().mockResolvedValue('saved'),
    exportFileAsDocx: vi.fn().mockResolvedValue('saved'),
    exportFileAsPdf: vi.fn().mockResolvedValue('saved'),
  };
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestContent,
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { workspaceFiles: { requestFileContent: {}, getFileContentV2: {} } },
}));

const writeText = vi.fn();

function stubClipboard(writeTextImpl: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeTextImpl },
  });
}

const defaultProps = {
  filePath: 'src/foo.ts',
  machineId: 'machine-1',
  workingDir: '/workspace',
  onClose: vi.fn(),
  files: [{ path: 'src/foo.ts', type: 'file' as const }],
  onSelectFile: vi.fn(),
};

function renderDialog() {
  return render(<FilePreviewDialog {...defaultProps} />);
}

async function findCopyContentButton() {
  return screen.findByRole('button', { name: 'Copy File Content' });
}

beforeEach(() => {
  vi.clearAllMocks();
  const compressed = gzipSync(Buffer.from('file body')).toString('base64');
  mockRequestContent.mockResolvedValue(undefined);
  mockUseSessionQuery.mockReturnValue({
    data: { compression: 'gzip', content: compressed },
    encoding: 'utf8',
    truncated: false,
    fetchedAt: 1,
  });
  writeText.mockResolvedValue(undefined);
  stubClipboard(writeText);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FilePreviewDialog copy feedback', () => {
  it('shows a toolbar copy failure as an alert in the dialog slot', async () => {
    writeText.mockRejectedValue(new Error('denied'));

    renderDialog();
    const button = await findCopyContentButton();

    await act(async () => {
      fireEvent.click(button);
    });

    const slot = await screen.findByTestId('file-preview-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to copy to clipboard');
    expect(writeText).toHaveBeenCalledWith('file body');
  });

  it('flips the toolbar copy icon to a check for 2 s and shows no copy text', async () => {
    renderDialog();
    const button = await findCopyContentButton();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
    expect(screen.queryByText(/Copied/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(button.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button.querySelector('svg.lucide-check')).toBeNull();
  });

  it('shows a dropdown copy failure in the dialog slot', async () => {
    writeText.mockRejectedValue(new Error('denied'));

    renderDialog();
    await findCopyContentButton();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));

    const item = await screen.findByRole('menuitem', { name: /copy relative path/i });
    await act(async () => {
      fireEvent.click(item);
    });

    const slot = await screen.findByTestId('file-preview-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to copy to clipboard');
    expect(writeText).toHaveBeenCalledWith('src/foo.ts');
  });

  it('clears a copy failure after a later successful copy', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));

    renderDialog();
    const button = await findCopyContentButton();

    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByTestId('file-preview-feedback')).toHaveTextContent(
      'Failed to copy to clipboard'
    );

    writeText.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
    });
  });
});

function mockContent(truncated: boolean) {
  const compressed = gzipSync(Buffer.from('file body')).toString('base64');
  mockUseSessionQuery.mockReturnValue({
    data: { compression: 'gzip', content: compressed },
    encoding: 'utf8',
    truncated,
    fetchedAt: 1,
  });
}

describe('FilePreviewDialog truncated copy warning', () => {
  it('shows the truncation warning in the dialog slot after a truncated toolbar copy', async () => {
    mockContent(true);
    renderDialog();
    const button = await findCopyContentButton();

    await act(async () => {
      fireEvent.click(button);
    });

    const slot = await screen.findByTestId('file-preview-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Copied file content (truncated)');
    expect(writeText).toHaveBeenCalledWith('file body');
  });

  it('shows the truncation warning after a truncated dropdown file content copy', async () => {
    mockContent(true);
    renderDialog();
    await findCopyContentButton();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));

    const item = await screen.findByRole('menuitem', { name: /copy file content/i });
    await act(async () => {
      fireEvent.click(item);
    });

    const slot = await screen.findByTestId('file-preview-feedback');
    expect(slot).toHaveAttribute('role', 'status');
    expect(slot).toHaveTextContent('Copied file content (truncated)');
  });

  it('shows nothing after a complete (not truncated) toolbar copy', async () => {
    mockContent(false);
    renderDialog();
    const button = await findCopyContentButton();

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('file body'));
    expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
  });

  it('shows nothing after a relative path copy while the content is truncated', async () => {
    mockContent(true);
    renderDialog();
    await findCopyContentButton();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));

    const item = await screen.findByRole('menuitem', { name: /copy relative path/i });
    await act(async () => {
      fireEvent.click(item);
    });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/foo.ts'));
    expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
  });

  it('clears the truncation warning on Dismiss', async () => {
    mockContent(true);
    renderDialog();
    const button = await findCopyContentButton();
    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByTestId('file-preview-feedback');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
  });

  it('clears the truncation warning on a later relative path copy', async () => {
    mockContent(true);
    renderDialog();
    const button = await findCopyContentButton();
    await act(async () => {
      fireEvent.click(button);
    });
    await screen.findByTestId('file-preview-feedback');

    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));
    const item = await screen.findByRole('menuitem', { name: /copy relative path/i });
    await act(async () => {
      fireEvent.click(item);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
    });
  });
});

describe('FilePreviewDialog open-on-remote feedback', () => {
  it('renders an error as an alert row', () => {
    render(
      <FilePreviewDialog
        {...defaultProps}
        onOpenFileOnRemote={vi.fn()}
        openOnRemoteFeedback={{ id: 1, tone: 'error', message: 'Failed to sync repository info' }}
      />
    );

    const row = screen.getByTestId('file-preview-open-on-remote-feedback');
    expect(row).toHaveAttribute('role', 'alert');
    expect(row).toHaveTextContent('Failed to sync repository info');
  });

  it('renders syncing as a status row', () => {
    render(
      <FilePreviewDialog
        {...defaultProps}
        onOpenFileOnRemote={vi.fn()}
        openOnRemoteFeedback={{
          id: 2,
          tone: 'info',
          message: 'Syncing repository info — try again in a moment',
        }}
      />
    );

    const row = screen.getByTestId('file-preview-open-on-remote-feedback');
    expect(row).toHaveAttribute('role', 'status');
    expect(row).toHaveTextContent('Syncing repository info — try again in a moment');
  });

  it('renders nothing when there is no feedback', () => {
    render(
      <FilePreviewDialog
        {...defaultProps}
        onOpenFileOnRemote={vi.fn()}
        openOnRemoteFeedback={null}
      />
    );

    expect(screen.queryByTestId('file-preview-open-on-remote-feedback')).toBeNull();
  });

  it('removes the row when the caller clears the feedback', () => {
    const { rerender } = render(
      <FilePreviewDialog
        {...defaultProps}
        onOpenFileOnRemote={vi.fn()}
        openOnRemoteFeedback={{ id: 1, tone: 'error', message: 'Failed to sync repository info' }}
      />
    );
    expect(screen.getByTestId('file-preview-open-on-remote-feedback')).toBeInTheDocument();

    rerender(
      <FilePreviewDialog
        {...defaultProps}
        onOpenFileOnRemote={vi.fn()}
        openOnRemoteFeedback={null}
      />
    );

    expect(screen.queryByTestId('file-preview-open-on-remote-feedback')).toBeNull();
  });

  it('calls onOpenFileOnRemote with the previewed path from the menu', async () => {
    const onOpenFileOnRemote = vi.fn();
    render(<FilePreviewDialog {...defaultProps} onOpenFileOnRemote={onOpenFileOnRemote} />);

    await findCopyContentButton();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));

    const item = await screen.findByRole('menuitem', { name: /open file on remote/i });
    fireEvent.click(item);

    expect(onOpenFileOnRemote).toHaveBeenCalledWith('src/foo.ts');
  });
});

const markdownProps = {
  ...defaultProps,
  filePath: 'docs/README.md',
  files: [{ path: 'docs/README.md', type: 'file' as const }],
};

function menuItemNames(): string[] {
  return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
}

function collectMenuItems(): { name: string; disabled: boolean }[] {
  return screen.getAllByRole('menuitem').map((item) => ({
    name: item.textContent?.trim() ?? '',
    disabled: item.getAttribute('aria-disabled') === 'true',
  }));
}

async function openMoreMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'More copy options' }));
  await screen.findAllByRole('menuitem');
}

describe('FilePreviewDialog download section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const compressed = gzipSync(Buffer.from('file body')).toString('base64');
    mockRequestContent.mockResolvedValue(undefined);
    mockUseSessionQuery.mockReturnValue({
      data: { compression: 'gzip', content: compressed },
      encoding: 'utf8',
      truncated: false,
      fetchedAt: 1,
    });
    writeText.mockResolvedValue(undefined);
    stubClipboard(writeText);
    vi.mocked(exportFileAsDocx).mockResolvedValue('saved');
  });

  it('lists the download rows in the ... menu for a markdown file', async () => {
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    await openMoreMenu();

    const names = menuItemNames();
    const downloadStart = names.indexOf('Download as Markdown');
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(downloadStart).toBeGreaterThanOrEqual(0);
    expect(names.slice(downloadStart, downloadStart + 3)).toEqual([
      'Download as Markdown',
      'Download as DOCX',
      'Download as PDF',
    ]);
  });

  it('shows no download section for a non-markdown file', async () => {
    renderDialog();
    await findCopyContentButton();
    await openMoreMenu();

    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download as Markdown' })).toBeNull();
  });

  it('opens the same items from the action-bar right-click as from the ... menu', async () => {
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });

    await openMoreMenu();
    const fromMoreMenu = collectMenuItems();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));

    fireEvent.contextMenu(screen.getByTestId('file-content-action-bar'));
    await screen.findAllByRole('menuitem');

    expect(collectMenuItems()).toEqual(fromMoreMenu);
  });

  it('keeps the native right-click on the rendered body', async () => {
    render(<FilePreviewDialog {...markdownProps} />);

    fireEvent.contextMenu(await screen.findByText('file body'));

    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('disables every download row with one reason for a truncated file', async () => {
    mockContent(true);
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });

    await openMoreMenu();

    const reasons = screen.getAllByTestId('workspace-download-disabled-reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveTextContent('File is larger than the 500 KB preview limit.');
    for (const name of ['Download as Markdown', 'Download as DOCX', 'Download as PDF']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('shows a DOCX failure in the dialog feedback slot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportFileAsDocx).mockRejectedValueOnce(new Error('boom'));
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    await openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as DOCX' }));

    const slot = await screen.findByTestId('file-preview-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to prepare DOCX');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes silently when the DOCX save is cancelled', async () => {
    vi.mocked(exportFileAsDocx).mockResolvedValueOnce('cancelled');
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    await openMoreMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as DOCX' }));

    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(screen.queryByTestId('file-preview-feedback')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('matches the disabled state of the ... menu and the action-bar right-click for a truncated file', async () => {
    mockContent(true);
    render(<FilePreviewDialog {...markdownProps} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    await openMoreMenu();
    const fromMoreMenu = collectMenuItems();
    fireEvent.click(screen.getByRole('button', { name: 'More copy options' }));
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));

    fireEvent.contextMenu(screen.getByTestId('file-content-action-bar'));
    await screen.findAllByRole('menuitem');

    expect(collectMenuItems()).toEqual(fromMoreMenu);
    expect(
      fromMoreMenu
        .filter((item) => item.name.startsWith('Download as'))
        .every((item) => item.disabled)
    ).toBe(true);
  });

  it('closes the action-bar right-click menu on Escape and keeps the dialog open', async () => {
    const onClose = vi.fn();
    render(<FilePreviewDialog {...markdownProps} onClose={onClose} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    fireEvent.contextMenu(screen.getByTestId('file-content-action-bar'));
    await screen.findAllByRole('menuitem');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the action-bar right-click menu on an outside click and keeps the dialog open', async () => {
    const onClose = vi.fn();
    render(<FilePreviewDialog {...markdownProps} onClose={onClose} />);
    await screen.findByRole('button', { name: 'Copy as Markdown' });
    fireEvent.contextMenu(screen.getByTestId('file-content-action-bar'));
    await screen.findAllByRole('menuitem');

    await userEvent.click(await screen.findByText('file body'));

    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(onClose).not.toHaveBeenCalled();
  });
});
