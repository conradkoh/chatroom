import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilePreviewDialog } from './FilePreviewDialog';

const FILE = {
  _id: 'attachment-1',
  filename: 'notes.txt',
  mimeType: 'text/plain',
  sizeBytes: 120,
};

const HTML_SOURCE = '<script>alert("xss")</script>\nplain text';

function stubTextResponse(body: BodyInit, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status }))
  );
}

describe('FilePreviewDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders HTML source as literal text and never injects a script element', async () => {
    stubTextResponse(HTML_SOURCE);
    const scriptsBefore = document.querySelectorAll('script').length;

    render(
      <FilePreviewDialog open onClose={vi.fn()} file={FILE} url="https://files.example/notes.txt" />
    );

    const pre = await screen.findByTestId('file-preview-text');
    expect(pre.textContent).toContain('<script>alert("xss")</script>');
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);
  });

  it('shows a truncation note when the file exceeds the preview cap', async () => {
    const big = new Uint8Array(300 * 1024).fill('a'.charCodeAt(0));
    stubTextResponse(big);

    render(
      <FilePreviewDialog
        open
        onClose={vi.fn()}
        file={{ ...FILE, sizeBytes: big.byteLength }}
        url="https://files.example/big.txt"
      />
    );

    expect(
      await screen.findByText(/Showing first 256 KB of 300 KB\. Download for the full file\./)
    ).toBeInTheDocument();
  });

  it('shows an error with Retry and refetches', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('recovered', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <FilePreviewDialog open onClose={vi.fn()} file={FILE} url="https://files.example/notes.txt" />
    );

    expect(await screen.findByText("Couldn't load this file.")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));

    expect(await screen.findByTestId('file-preview-text')).toHaveTextContent('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the gone state when the url is gone while open', () => {
    render(<FilePreviewDialog open onClose={vi.fn()} file={FILE} url={null} />);

    expect(screen.getByText('This file is no longer available.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Download notes.txt')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <FilePreviewDialog open onClose={onClose} file={FILE} url="https://files.example/notes.txt" />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an image error with Retry', async () => {
    render(
      <FilePreviewDialog
        open
        onClose={vi.fn()}
        file={{ ...FILE, filename: 'shot.png', mimeType: 'image/png' }}
        url="https://files.example/shot.png"
      />
    );

    const image = screen.getByAltText('shot.png');
    fireEvent.error(image);

    expect(await screen.findByText("Couldn't load this image.")).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getAllByText('Download').length).toBeGreaterThan(0);
  });
});
