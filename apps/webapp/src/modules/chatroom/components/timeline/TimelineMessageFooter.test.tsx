/**
 * TimelineMessageFooter — copy, download, attach-as-context, and timestamp.
 */

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu)
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TimelineMessageFooter } from './TimelineMessageFooter';
import { AttachmentsProvider } from '../../attachments';
import type { Message } from '../../types/message';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('../../viewModels/eventStreamViewModel', () => ({
  formatTimestamp: (time: number) => `TS:${time}`,
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello footer',
    _creationTime: 1_700_000_000_000,
    ...overrides,
  };
}

function renderFooter(message: Message, props: { isEnhanced?: boolean } = {}) {
  return render(
    <AttachmentsProvider>
      <TimelineMessageFooter message={message} {...props} />
    </AttachmentsProvider>
  );
}

describe('TimelineMessageFooter', () => {
  it('renders copy, download, attach, and timestamp', () => {
    renderFooter(makeMessage());
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
    expect(screen.getByTitle('Copy as markdown')).toBeInTheDocument();
    expect(screen.getByTitle('Download message')).toBeInTheDocument();
    expect(screen.getByTitle('Add to context')).toBeInTheDocument();
    expect(screen.getByText('TS:1700000000000')).toBeInTheDocument();
  });

  it('shows blue enhanced indicator before timestamp when isEnhanced', () => {
    renderFooter(makeMessage(), { isEnhanced: true });

    const indicator = screen.getByTestId('timeline-enhanced-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('text-blue-500');
    expect(indicator.compareDocumentPosition(screen.getByText('TS:1700000000000'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('hides enhanced indicator when not enhanced', () => {
    renderFooter(makeMessage(), { isEnhanced: false });

    expect(screen.queryByTestId('timeline-enhanced-indicator')).not.toBeInTheDocument();
  });
});
