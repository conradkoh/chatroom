import { gzipSync } from 'node:zlib';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilePreviewDialog } from './FilePreviewDialog';

const mockUseSessionQuery = vi.hoisted(() => vi.fn());
const mockRequestContent = vi.hoisted(() => vi.fn());

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
