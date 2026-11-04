import { Blob as NodeBlob } from 'node:buffer';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttachedFileView } from '@workspace/backend/src/domain/entities/file-attachment';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageFileAttachments } from './MessageFileAttachments';

const mocks = vi.hoisted(() => ({
  getFileUrls: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mocks.getFileUrls();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { fileAttachments: { getFileUrls: 'fileAttachments.getFileUrls' } },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

const IMAGE_FILE = {
  _id: 'a1',
  status: 'available',
  filename: 'shot.png',
  mimeType: 'image/png',
  sizeBytes: 1536,
} as const;

function asFiles(files: unknown[]): AttachedFileView[] {
  return files as AttachedFileView[];
}

function stubDownload(bytes: BodyInit, status = 200) {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes, { status }))
  );
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return createObjectURL;
}

describe('MessageFileAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFileUrls.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no files', () => {
    const { container } = render(<MessageFileAttachments files={[]} showMedia />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the layout, shows a skeleton, and disables actions while urls load', () => {
    mocks.getFileUrls.mockReturnValue(undefined);

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia />);

    expect(screen.getByTestId('message-file-attachments')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.getByLabelText('Download shot.png')).toBeDisabled();
    expect(screen.queryByAltText('shot.png')).not.toBeInTheDocument();
  });

  it('renders an image thumbnail for an auto-loaded file', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/shot.png' },
    ]);

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia />);

    const image = await screen.findByAltText('shot.png');
    expect(image).toHaveAttribute('src', 'https://files.example/shot.png');
  });

  it('omits media in the collapsed state', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/shot.png' },
    ]);

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia={false} />);

    await screen.findByLabelText('Preview shot.png');
    expect(screen.queryByAltText('shot.png')).not.toBeInTheDocument();
  });

  it('shows removed and no-longer-available rows without actions', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a2', url: null },
      { attachmentId: 'a3', url: 'https://files.example/live.txt' },
    ]);

    render(
      <MessageFileAttachments
        files={asFiles([
          { _id: 'a1', status: 'removed' },
          {
            _id: 'a2',
            status: 'available',
            filename: 'gone.txt',
            mimeType: 'text/plain',
            sizeBytes: 2048,
          },
          {
            _id: 'a3',
            status: 'available',
            filename: 'live.txt',
            mimeType: 'text/plain',
            sizeBytes: 1024,
          },
        ])}
        showMedia
      />
    );

    expect(await screen.findByText('No longer available')).toBeInTheDocument();
    expect(screen.getByText('File removed')).toBeInTheDocument();
    expect(screen.getByText('Deleted to free storage')).toBeInTheDocument();
    expect(screen.getByText('3 files · 3 KB')).toBeInTheDocument();
    expect(screen.queryByLabelText('Download gone.txt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview gone.txt')).not.toBeInTheDocument();
  });

  it('shows the error banner and remounts the list on Retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let shouldThrow = true;
    mocks.getFileUrls.mockImplementation(() => {
      if (shouldThrow) throw { data: { code: 'ACCESS_DENIED' } };
      return [{ attachmentId: 'a1', url: 'https://files.example/shot.png' }];
    });

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia />);

    expect(await screen.findByText("Files couldn't be loaded.")).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByText('Retry'));

    expect(await screen.findByAltText('shot.png')).toBeInTheDocument();
    expect(mocks.getFileUrls).toHaveBeenCalledTimes(3);
  });

  it('waits for a click before loading a large image preview', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/big.png' },
    ]);

    render(
      <MessageFileAttachments
        files={asFiles([
          {
            _id: 'a1',
            status: 'available',
            filename: 'big.png',
            mimeType: 'image/png',
            sizeBytes: 3 * 1024 * 1024,
          },
        ])}
        showMedia
      />
    );

    const loadButton = await screen.findByRole('button', { name: /Load preview/ });
    expect(screen.queryByAltText('big.png')).not.toBeInTheDocument();

    fireEvent.click(loadButton);
    expect(await screen.findByAltText('big.png')).toBeInTheDocument();
  });

  it('opens a PDF in a new tab with no opener', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/report.pdf' },
    ]);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <MessageFileAttachments
        files={asFiles([
          {
            _id: 'a1',
            status: 'available',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4096,
          },
        ])}
        showMedia
      />
    );

    fireEvent.click(await screen.findByLabelText('Open report.pdf in new tab'));

    expect(open).toHaveBeenCalledWith(
      'https://files.example/report.pdf',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('downloads the original bytes as an octet-stream blob', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/shot.png' },
    ]);
    const createObjectURL = stubDownload(new Uint8Array([1, 2, 3]));

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia={false} />);

    fireEvent.click(await screen.findByLabelText('Download shot.png'));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/octet-stream');
  });

  it('shows a toast when a download fails', async () => {
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/shot.png' },
    ]);
    stubDownload('', 500);

    render(<MessageFileAttachments files={asFiles([IMAGE_FILE])} showMedia={false} />);

    fireEvent.click(await screen.findByLabelText('Download shot.png'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't download shot.png. Try again.")
    );
  });
});
