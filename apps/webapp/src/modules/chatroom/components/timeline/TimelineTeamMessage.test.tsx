import { render, screen, fireEvent } from '@testing-library/react';
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
  content: 'Enhanced handoff content',
  _creationTime: 1000,
};

describe('TimelineTeamMessage enhancer toggle', () => {
  it('shows no toggle when message has no enhancerOriginalContent', () => {
    render(<TimelineTeamMessage message={BASE_MESSAGE} chatroomId="room-1" />);

    expect(screen.queryByTestId('enhancer-content-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-enhanced-indicator')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
      'Enhanced handoff content'
    );
  });

  it('shows toggle and enhanced content by default when enhancerOriginalContent exists', () => {
    render(
      <TimelineTeamMessage
        message={{
          ...BASE_MESSAGE,
          enhancerOriginalContent: 'Original draft content',
        }}
        chatroomId="room-1"
      />
    );

    expect(screen.getByTestId('enhancer-content-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-enhanced-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
      'Enhanced handoff content'
    );
  });

  it('clicking toggle switches body to original content', () => {
    render(
      <TimelineTeamMessage
        message={{
          ...BASE_MESSAGE,
          enhancerOriginalContent: 'Original draft content',
        }}
        chatroomId="room-1"
      />
    );

    fireEvent.click(screen.getByTestId('enhancer-content-toggle'));

    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
      'Original draft content'
    );
  });

  it('clicking toggle twice switches back to enhanced content', () => {
    render(
      <TimelineTeamMessage
        message={{
          ...BASE_MESSAGE,
          enhancerOriginalContent: 'Original draft content',
        }}
        chatroomId="room-1"
      />
    );

    fireEvent.click(screen.getByTestId('enhancer-content-toggle'));
    fireEvent.click(screen.getByTestId('enhancer-content-toggle'));

    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
      'Enhanced handoff content'
    );
  });
});
