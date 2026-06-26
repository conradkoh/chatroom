/**
 * TimelineMessageFooter — copy, attach-as-context, and timestamp.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TimelineMessageFooter } from './TimelineMessageFooter';
import { AttachmentsProvider } from '../../attachments';
import type { Message } from '../../types/message';

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

function renderFooter(message: Message) {
  return render(
    <AttachmentsProvider>
      <TimelineMessageFooter message={message} />
    </AttachmentsProvider>
  );
}

describe('TimelineMessageFooter', () => {
  it('renders copy, attach, and timestamp', () => {
    renderFooter(makeMessage());
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
    expect(screen.getByTitle('Copy as markdown')).toBeInTheDocument();
    expect(screen.getByTitle('Add to context')).toBeInTheDocument();
    expect(screen.getByText('TS:1700000000000')).toBeInTheDocument();
  });
});
