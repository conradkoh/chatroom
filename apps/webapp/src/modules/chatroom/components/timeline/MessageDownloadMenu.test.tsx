import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import { exportMessageAsDocx, exportMessageAsPdf, saveTextFile } from '../../lib/messageExport';
import type { Message } from '../../types/message';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('../../lib/messageExport', async () => {
  const formats = (await vi.importActual('../../lib/messageExport/downloadFormats')) as Record<
    string,
    unknown
  >;
  return {
    ...formats,
    saveTextFile: vi.fn().mockResolvedValue('saved'),
    messageExportFilename: (_message: Message, ext: string) => `test-${ext}`,
    buildMessageMarkdownDownload: (message: Message) => `# ${message.content}`,
    exportMessageAsDocx: vi.fn().mockResolvedValue('saved'),
    exportMessageAsPdf: vi.fn().mockResolvedValue('saved'),
  };
});

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

/** A successful export must show no status or alert message at all. */
function expectNoStatusMessage() {
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
}

describe('MessageDownloadMenu', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
    vi.mocked(saveTextFile).mockResolvedValue('saved');
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

  it('downloads markdown without showing a success message', async () => {
    const user = userEvent.setup();
    vi.mocked(saveTextFile).mockResolvedValueOnce('downloaded');

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as Markdown'));

    await waitFor(() => expect(screen.queryByText('Download as Markdown')).not.toBeInTheDocument());
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expectNoStatusMessage();
  });

  it('exports the message as DOCX without showing a success message', async () => {
    const user = userEvent.setup();
    const message = makeMessage();
    vi.mocked(exportMessageAsDocx).mockResolvedValueOnce('saved');

    render(<MessageDownloadMenu message={message} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as DOCX'));

    await waitFor(() => expect(screen.queryByText('Download as DOCX')).not.toBeInTheDocument());
    expect(exportMessageAsDocx).toHaveBeenCalledWith(message);
    expectNoStatusMessage();
  });

  it('exports the message as PDF without showing a success message', async () => {
    const user = userEvent.setup();
    const message = makeMessage();
    vi.mocked(exportMessageAsPdf).mockResolvedValueOnce('downloaded');

    render(<MessageDownloadMenu message={message} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    await waitFor(() => expect(screen.queryByText('Download as PDF')).not.toBeInTheDocument());
    expect(exportMessageAsPdf).toHaveBeenCalledWith(message);
    expectNoStatusMessage();
  });

  it('shows one inline alert that stays after the menu closes when the PDF export fails', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('boom');
    vi.mocked(exportMessageAsPdf).mockRejectedValueOnce(error);

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to prepare PDF');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('PDF'), error);
    expect(screen.queryByText('Download as PDF')).not.toBeInTheDocument();

    // Menu is closed; the alert is still visible.
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to prepare PDF');
  });

  it('shows one inline alert that stays after the menu closes when the DOCX export fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportMessageAsDocx).mockRejectedValueOnce(new Error('boom'));

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as DOCX'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to prepare DOCX');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('Download as DOCX')).not.toBeInTheDocument();
  });

  it('clears the failure when the next export starts', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportMessageAsPdf).mockRejectedValueOnce(new Error('boom'));
    const pending = deferred<'saved'>();
    vi.mocked(exportMessageAsDocx).mockReturnValueOnce(pending.promise);

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));
    await screen.findByRole('alert');

    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as DOCX'));

    expect(screen.queryByRole('alert')).toBeNull();
    pending.resolve('saved');
    await waitFor(() => expect(screen.queryByText('Preparing DOCX...')).not.toBeInTheDocument());
    expectNoStatusMessage();
  });

  it('closes the menu without a message and leaves rows enabled after the PDF save is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(exportMessageAsPdf).mockResolvedValueOnce('cancelled');

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as PDF'));

    await waitFor(() => expect(screen.queryByText('Download as PDF')).not.toBeInTheDocument());
    expectNoStatusMessage();

    await user.click(screen.getByTitle('Download message'));
    expect(screen.getByRole('option', { name: 'Download as PDF' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Download as DOCX' })).toBeEnabled();
  });

  it('closes the menu without a message and leaves rows enabled after the DOCX save is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(exportMessageAsDocx).mockResolvedValueOnce('cancelled');

    render(<MessageDownloadMenu message={makeMessage()} />);
    await user.click(screen.getByTitle('Download message'));
    await user.click(screen.getByText('Download as DOCX'));

    await waitFor(() => expect(screen.queryByText('Download as DOCX')).not.toBeInTheDocument());
    expectNoStatusMessage();

    await user.click(screen.getByTitle('Download message'));
    expect(screen.getByRole('option', { name: 'Download as DOCX' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Download as PDF' })).toBeEnabled();
  });

  // Busy-state tests below are unchanged from the original file.
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
