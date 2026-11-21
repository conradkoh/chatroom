import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import { exportMessageAsDocx, exportMessageAsPdf } from '../../lib/messageExport';
import type { Message } from '../../types/message';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/messageExport', () => ({
  saveTextFile: vi.fn().mockResolvedValue('saved'),
  messageExportFilename: (_message: Message, ext: string) => `test-${ext}`,
  buildMessageMarkdownDownload: (message: Message) => `# ${message.content}`,
  exportMessageAsDocx: vi.fn().mockResolvedValue('saved'),
  exportMessageAsPdf: vi.fn().mockResolvedValue('saved'),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello',
    _creationTime: 1_700_000_000_000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('MessageDownloadMenu', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
    vi.mocked(exportMessageAsDocx).mockResolvedValue('saved');
    vi.mocked(exportMessageAsPdf).mockResolvedValue('saved');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders download trigger button', () => {
    render(<MessageDownloadMenu message={makeMessage()} />);
    expect(screen.getByTitle('Download message')).toBeInTheDocument();
  });

  it('shows markdown, docx and pdf options', async () => {
    const user = userEvent.setup();
    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    expect(screen.getByText('Download as Markdown')).toBeInTheDocument();
    expect(screen.getByText('Download as DOCX')).toBeInTheDocument();
    expect(screen.getByText('Download as PDF')).toBeInTheDocument();
  });

  it('exports the message as PDF and toasts the download', async () => {
    const user = userEvent.setup();
    const message = makeMessage();
    vi.mocked(exportMessageAsPdf).mockResolvedValueOnce('downloaded');

    render(<MessageDownloadMenu message={message} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    expect(exportMessageAsPdf).toHaveBeenCalledWith(message);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Downloaded PDF'));
  });

  it('toasts an error, closes the menu, and resets busy when the PDF export fails', async () => {
    const user = userEvent.setup();
    vi.mocked(exportMessageAsPdf).mockRejectedValueOnce(new Error('boom'));

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to prepare PDF'));
    expect(screen.queryByText('Download as PDF')).not.toBeInTheDocument();

    await user.click(screen.getByTitle('Download message'));
    expect(screen.getByText('Download as PDF')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Download as PDF' })).toBeEnabled();
  });

  it('shows a disabled busy row while the PDF export is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<'saved'>();
    vi.mocked(exportMessageAsPdf).mockReturnValueOnce(pending.promise);

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    const busyRow = screen.getByRole('option', { name: 'Preparing PDF...' });
    expect(busyRow).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Download as DOCX' })).toBeDisabled();
    expect(screen.queryByText('Preparing DOCX...')).not.toBeInTheDocument();

    pending.resolve('saved');
    await waitFor(() => expect(screen.queryByText('Preparing PDF...')).not.toBeInTheDocument());
  });

  it('shows the busy label only on the DOCX row while the DOCX export is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<'saved'>();
    vi.mocked(exportMessageAsDocx).mockReturnValueOnce(pending.promise);

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as DOCX'));

    expect(screen.getByRole('option', { name: 'Preparing DOCX...' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Download as PDF' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Download as Markdown' })).toBeDisabled();
    expect(screen.queryByText('Preparing PDF...')).not.toBeInTheDocument();

    pending.resolve('saved');
    await waitFor(() => expect(screen.queryByText('Preparing DOCX...')).not.toBeInTheDocument());
  });
});
