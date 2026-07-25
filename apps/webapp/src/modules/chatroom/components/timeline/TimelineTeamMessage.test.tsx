import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineTeamMessage } from './TimelineTeamMessage';
import type * as AttachmentsModule from '../../attachments';
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

vi.mock('./TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => (
    <div data-testid="timeline-markdown-body">{content}</div>
  ),
}));

vi.mock('../../attachments', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof AttachmentsModule;
  return {
    ...actual,
    useAttachments: () => ({
      add: vi.fn(),
      isAttached: () => false,
    }),
  };
});

const BASE_MESSAGE: Message = {
  _id: 'msg-1',
  type: 'handoff',
  senderRole: 'planner',
  targetRole: 'enhancer',
  content: 'Draft handoff content',
  _creationTime: 1000,
};

describe('TimelineTeamMessage', () => {
  it('renders sender, target, and message body', () => {
    render(<TimelineTeamMessage message={BASE_MESSAGE} chatroomId="room-1" />);

    expect(screen.getByText('planner')).toBeInTheDocument();
    expect(screen.getByText('enhancer')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent('Draft handoff content');
  });
});
