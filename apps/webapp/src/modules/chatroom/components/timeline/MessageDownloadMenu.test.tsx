import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageDownloadMenu } from './MessageDownloadMenu';
import type { Message } from '../../types/message';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('../../lib/messageExport', () => ({
  downloadTextFile: vi.fn(),
  messageExportFilename: (_message: Message, ext: string) => `test-${ext}`,
  buildMessageMarkdownDownload: (message: Message) => `# ${message.content}`,
  printMessageAsPdf: vi.fn().mockResolvedValue(undefined),
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

describe('MessageDownloadMenu', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders download trigger button', () => {
    render(<MessageDownloadMenu message={makeMessage()} />);
    expect(screen.getByTitle('Download message')).toBeInTheDocument();
  });
});
