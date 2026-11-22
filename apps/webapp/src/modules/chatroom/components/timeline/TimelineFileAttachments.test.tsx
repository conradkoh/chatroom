import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineFileAttachments } from './TimelineFileAttachments';
import type { Message } from '../../types/message';

const mocks = vi.hoisted(() => ({ getFileUrls: vi.fn() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mocks.getFileUrls();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { fileAttachments: { getFileUrls: 'fileAttachments.getFileUrls' } },
}));

type Files = NonNullable<Message['attachedFiles']>;
const FILES = [
  {
    _id: 'a1',
    status: 'available',
    filename: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: 1536,
  },
] as unknown as Files;

describe('TimelineFileAttachments', () => {
  beforeEach(() => {
    mocks.getFileUrls.mockReset();
    mocks.getFileUrls.mockReturnValue([
      { attachmentId: 'a1', url: 'https://files.example/shot.png' },
    ]);
  });

  it.each([undefined, []])('renders nothing when files is %j', (files) => {
    const { container } = render(<TimelineFileAttachments files={files} showMedia />);
    expect(container).toBeEmptyDOMElement();
  });

  it('wraps the attachment list in a div that carries className', () => {
    const { container } = render(
      <TimelineFileAttachments files={FILES} showMedia={false} className="mt-2" />
    );
    expect(container.firstElementChild).toHaveClass('mt-2');
    expect(screen.getByTestId('message-file-attachments')).toBeInTheDocument();
  });

  it('shows image media when showMedia is true', async () => {
    render(<TimelineFileAttachments files={FILES} showMedia />);
    expect(await screen.findByAltText('shot.png')).toHaveAttribute(
      'src',
      'https://files.example/shot.png'
    );
  });

  it('omits image media when showMedia is false', async () => {
    render(<TimelineFileAttachments files={FILES} showMedia={false} />);
    await screen.findByLabelText('Preview shot.png');
    expect(screen.queryByAltText('shot.png')).not.toBeInTheDocument();
  });
});
