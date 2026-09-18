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

vi.mock('./HandoffEnvelopeView', () => ({
  HandoffEnvelopeView: ({
    content,
    variant,
    initiallyExpanded = false,
  }: {
    content: string;
    variant: string;
    initiallyExpanded?: boolean;
  }) => (
    <div
      data-testid="handoff-envelope-view"
      data-variant={variant}
      data-initially-expanded={String(initiallyExpanded)}
    >
      {content}
    </div>
  ),
}));

const BASE_MESSAGE: Message = {
  _id: 'msg-1',
  type: 'handoff',
  senderRole: 'planner',
  content: 'Handoff content',
  _creationTime: 1000,
};

describe('TimelineTeamMessage', () => {
  it('renders ordinary markdown and generic footer metadata', () => {
    render(
      <TimelineTeamMessage message={BASE_MESSAGE} chatroomId="room-1" handoffDurationMs={62_000} />
    );

    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent('Handoff content');
    expect(screen.getByTestId('timeline-handoff-duration')).toHaveTextContent('1m 2s');
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
  });

  it('renders HandoffEnvelopeView with generic collapsed defaults', () => {
    const envelopeMessage: Message = {
      ...BASE_MESSAGE,
      targetRole: 'builder',
      content: '<user-message>hello</user-message><grounding>notes</grounding>',
    };
    render(<TimelineTeamMessage message={envelopeMessage} chatroomId="room-1" />);
    const envelopeView = screen.getByTestId('handoff-envelope-view');
    expect(envelopeView).toBeInTheDocument();
    expect(envelopeView).toHaveAttribute('data-initially-expanded', 'false');
    expect(screen.queryByTestId('timeline-markdown-body')).not.toBeInTheDocument();
  });

  it('renders HandoffEnvelopeView collapsed for any ordinary sender', () => {
    const envelopeMessage: Message = {
      ...BASE_MESSAGE,
      senderRole: 'builder',
      targetRole: 'planner',
      content: '<user-message>hi</user-message><grounding>notes</grounding>',
    };
    render(<TimelineTeamMessage message={envelopeMessage} chatroomId="room-1" />);
    const envelopeView = screen.getByTestId('handoff-envelope-view');
    expect(envelopeView).toBeInTheDocument();
    expect(envelopeView).toHaveAttribute('data-initially-expanded', 'false');
    expect(screen.queryByTestId('timeline-markdown-body')).not.toBeInTheDocument();
  });

  it('renders HandoffReportView for structured handoff content', () => {
    const reportMessage: Message = {
      ...BASE_MESSAGE,
      senderRole: 'builder',
      targetRole: 'planner',
      content: `<handoff-overview>
## Summary
Looks good overall
</handoff-overview>

<handoff-action>
## Risks & failure modes
Edge case X
</handoff-action>`,
    };
    render(<TimelineTeamMessage message={reportMessage} chatroomId="room-1" />);
    expect(screen.getByTestId('handoff-report-view')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-overview')).toBeInTheDocument();
    expect(screen.getByTestId('handoff-section-action')).toBeInTheDocument();
  });

  describe('presentation-fence unwrapping', () => {
    it('unwraps the outer markdown fence for handoffs while preserving inner code fences', () => {
      const wrappedHandoff: Message = {
        ...BASE_MESSAGE,
        content:
          '```markdown\n## Summary\nHello world\n\n```typescript\nconst value = 1;\n```\n```',
      };
      render(<TimelineTeamMessage message={wrappedHandoff} chatroomId="room-1" />);
      const body = screen.getByTestId('timeline-markdown-body');
      expect(body).toHaveTextContent('## Summary');
      expect(body).toHaveTextContent('Hello world');
      expect(body.textContent).toContain('```typescript');
      expect(body.textContent).toContain('const value = 1;');
      expect(body.textContent).not.toContain('```markdown');
    });

    it('routes a fenced handoff report through HandoffReportView without the outer wrapper', () => {
      const wrappedReport: Message = {
        ...BASE_MESSAGE,
        senderRole: 'builder',
        targetRole: 'planner',
        content:
          '```markdown\n<handoff-overview>\n## Summary\nLooks good overall\n</handoff-overview>\n\n<handoff-action>\n## Risks & failure modes\nEdge case X\n</handoff-action>\n```',
      };
      render(<TimelineTeamMessage message={wrappedReport} chatroomId="room-1" />);
      const reportView = screen.getByTestId('handoff-report-view');
      expect(reportView).toBeInTheDocument();
      expect(screen.getByTestId('handoff-section-overview')).toBeInTheDocument();
      expect(screen.getByTestId('handoff-section-action')).toBeInTheDocument();
      expect(reportView.textContent).not.toContain('```markdown');
    });

    it('passes non-handoff messages through unchanged even when they contain a presentation fence', () => {
      const wrappedContent =
        '```markdown\n## Summary\nHello world\n\n```typescript\nconst value = 1;\n```\n```';
      const plainMessage: Message = {
        ...BASE_MESSAGE,
        type: 'message',
        content: wrappedContent,
      };
      render(<TimelineTeamMessage message={plainMessage} chatroomId="room-1" />);
      const body = screen.getByTestId('timeline-markdown-body');
      expect(body.textContent).toContain('```markdown');
      expect(body.textContent).toContain('## Summary');
      expect(body.textContent).toContain('```typescript');
    });
  });

  it('uses true-center grid on header when headerNavigation provided', () => {
    render(
      <TimelineTeamMessage
        message={BASE_MESSAGE}
        chatroomId="room-1"
        headerNavigation={{
          onJumpToFirst: vi.fn(),
          onJumpToPrevious: vi.fn(),
          onJumpToCurrent: vi.fn(),
          onJumpToNext: vi.fn(),
          onJumpToLast: vi.fn(),
          hasFirst: true,
          hasPrevious: true,
          hasNext: true,
          hasLast: true,
        }}
      />
    );
    const header = screen.getByTestId('timeline-message-header');
    expect(header.className).toContain('grid-cols-[1fr_auto_1fr]');
    expect(screen.getByTestId('timeline-message-header-nav')).toBeInTheDocument();
  });

  it('keeps flex layout on header when headerNavigation omitted', () => {
    render(<TimelineTeamMessage message={BASE_MESSAGE} chatroomId="room-1" />);
    const header = screen.getByTestId('timeline-message-header');
    expect(header.className).not.toContain('grid-cols-[1fr_auto_1fr]');
    expect(screen.queryByTestId('timeline-message-header-nav')).not.toBeInTheDocument();
  });
});
