import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineTeamMessage } from './TimelineTeamMessage';
import type * as AttachmentsModule from '../../attachments';
import type { Message } from '../../types/message';
import { formatTimestamp } from '../../utils/chatroomTimestamp';
import type * as NormalizeModule from '../../utils/normalizeChatroomMarkdownContent';
import { normalizeChatroomMarkdownContent } from '../../utils/normalizeChatroomMarkdownContent';
import type * as EnvelopeModule from '../../utils/parseHandoffEnvelope';
import { hasHandoffEnvelope } from '../../utils/parseHandoffEnvelope';
import type * as ReportModule from '../../utils/parseHandoffReport';
import { hasHandoffReport } from '../../utils/parseHandoffReport';

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

const { markdownBodyMock } = vi.hoisted(() => ({ markdownBodyMock: vi.fn() }));

vi.mock('./TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => {
    markdownBodyMock({ content });
    return <div data-testid="timeline-markdown-body">{content}</div>;
  },
}));

// Pass-through spies: the real parsing helpers run, but the collapse tests can
// prove that a collapsed row never reaches them.
vi.mock('../../utils/normalizeChatroomMarkdownContent', async (importOriginal) => {
  const actual = await importOriginal<typeof NormalizeModule>();
  return {
    ...actual,
    normalizeChatroomMarkdownContent: vi.fn(actual.normalizeChatroomMarkdownContent),
  };
});

vi.mock('../../utils/parseHandoffEnvelope', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvelopeModule>();
  return { ...actual, hasHandoffEnvelope: vi.fn(actual.hasHandoffEnvelope) };
});

vi.mock('../../utils/parseHandoffReport', async (importOriginal) => {
  const actual = await importOriginal<typeof ReportModule>();
  return { ...actual, hasHandoffReport: vi.fn(actual.hasHandoffReport) };
});

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

const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

beforeEach(() => {
  markdownBodyMock.mockClear();
  vi.mocked(normalizeChatroomMarkdownContent).mockClear();
  vi.mocked(hasHandoffEnvelope).mockClear();
  vi.mocked(hasHandoffReport).mockClear();
  scrollIntoViewMock.mockClear();
});

// Exact prod handoff shape whose inline code contains HTML-like text.
const HANDOFF_BODY = [
  '## Summary',
  'Your slice is **accepted**.',
  '',
  '## Files',
  '- Budgets: `bond budget list --currency <code> [--at]`',
].join('\n');

describe('TimelineTeamMessage', () => {
  it('renders ordinary markdown and generic footer metadata', () => {
    render(
      <TimelineTeamMessage message={BASE_MESSAGE} chatroomId="room-1" handoffDurationMs={62_000} />
    );

    expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent('Handoff content');
    expect(screen.getByTestId('timeline-handoff-duration')).toHaveTextContent('1m 2s');
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
  });

  it('hands inline-code HTML-like handoff markdown to the renderer unchanged', () => {
    const handoffMessage: Message = { ...BASE_MESSAGE, content: HANDOFF_BODY };
    render(<TimelineTeamMessage message={handoffMessage} chatroomId="room-1" />);

    expect(markdownBodyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: HANDOFF_BODY })
    );
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

  describe('notice messages', () => {
    const NOTICE_MESSAGE: Message = {
      ...BASE_MESSAGE,
      type: 'notice',
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Build finished. Ready for review.',
    };

    it('renders an informational notice badge and no handoff badge', () => {
      render(<TimelineTeamMessage message={NOTICE_MESSAGE} chatroomId="room-1" />);

      const badge = screen.getByText('notice');
      expect(badge).toHaveClass('bg-chatroom-status-info/15');
      expect(badge).toHaveClass('text-chatroom-status-info');
      expect(screen.queryByText('handoff')).not.toBeInTheDocument();
    });

    it('renders the notice body through the plain markdown body unchanged', () => {
      render(<TimelineTeamMessage message={NOTICE_MESSAGE} chatroomId="room-1" />);

      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Build finished. Ready for review.'
      );
    });

    it('does not render handoff envelope/report views for envelope-shaped notice content', () => {
      const envelopeNotice: Message = {
        ...NOTICE_MESSAGE,
        content: '<user-message>hello</user-message><grounding>notes</grounding>',
      };
      render(<TimelineTeamMessage message={envelopeNotice} chatroomId="room-1" />);

      expect(screen.queryByTestId('handoff-envelope-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent('<user-message>hello');
    });

    it('does not render handoff report views for report-shaped notice content', () => {
      const reportNotice: Message = {
        ...NOTICE_MESSAGE,
        content: `<handoff-overview>
## Summary
Looks good overall
</handoff-overview>

<handoff-action>
## Risks & failure modes
Edge case X
</handoff-action>`,
      };
      render(<TimelineTeamMessage message={reportNotice} chatroomId="room-1" />);

      expect(screen.queryByTestId('handoff-report-view')).not.toBeInTheDocument();
      expect(screen.queryByTestId('handoff-section-overview')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent('Looks good overall');
    });

    it('does not unwrap a presentation fence for notice content', () => {
      const fencedNotice: Message = {
        ...NOTICE_MESSAGE,
        content: '```markdown\n## Summary\nHello world\n```',
      };
      render(<TimelineTeamMessage message={fencedNotice} chatroomId="room-1" />);

      const body = screen.getByTestId('timeline-markdown-body');
      expect(body.textContent).toContain('```markdown');
      expect(body.textContent).toContain('## Summary');
    });

    it('renders no handoff duration chip for notices', () => {
      const { unmount } = render(
        <TimelineTeamMessage message={NOTICE_MESSAGE} chatroomId="room-1" />
      );
      expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();
      unmount();

      render(
        <TimelineTeamMessage
          message={NOTICE_MESSAGE}
          chatroomId="room-1"
          handoffDurationMs={undefined}
        />
      );
      expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();
    });

    it('exposes the notice type on the root and shows sender → user in the header', () => {
      render(<TimelineTeamMessage message={NOTICE_MESSAGE} chatroomId="room-1" />);

      expect(screen.getByTestId('timeline-team-message')).toHaveAttribute(
        'data-message-type',
        'notice'
      );
      expect(screen.getByText('builder')).toBeInTheDocument();
      expect(screen.getByText('user')).toBeInTheDocument();
    });

    it('keeps the grid header and notice badge when headerNavigation is supplied', () => {
      render(
        <TimelineTeamMessage
          message={NOTICE_MESSAGE}
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

      expect(screen.getByTestId('timeline-message-header').className).toContain(
        'grid-cols-[1fr_auto_1fr]'
      );
      expect(screen.getByText('notice')).toBeInTheDocument();
    });
  });

  it('renders no type badge for a plain team message and exposes its type on the root', () => {
    const plainMessage: Message = {
      ...BASE_MESSAGE,
      type: 'message',
      senderRole: 'planner',
      content: 'Ordinary reply',
    };
    render(<TimelineTeamMessage message={plainMessage} chatroomId="room-1" />);

    expect(screen.queryByText('notice')).not.toBeInTheDocument();
    expect(screen.queryByText('handoff')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-team-message')).toHaveAttribute(
      'data-message-type',
      'message'
    );
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

  describe('collapsible agent-to-agent rows', () => {
    const COLLAPSIBLE_HANDOFF: Message = {
      ...BASE_MESSAGE,
      senderRole: 'builder',
      targetRole: 'planner',
      content: 'Preview sentence one.\nPreview sentence two.\n\nDeferred body sentence.',
    };

    const collapsedTime = () => formatTimestamp(COLLAPSIBLE_HANDOFF._creationTime);

    it('starts collapsed as a summary bar with preview, time, and no footer or body', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);
      const toggle = screen.getByTestId('timeline-handoff-toggle');

      expect(within(toggle).getByTestId('timeline-handoff-preview')).toHaveTextContent(
        'Preview sentence one. Preview sentence two.'
      );
      expect(within(toggle).getByText(collapsedTime())).toBeInTheDocument();
      expect(screen.queryByText(/Deferred body sentence/)).not.toBeInTheDocument();
      expect(document.querySelector('.prose')).toBeNull();
      expect(markdownBodyMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-message-header')).toBeInTheDocument();
      expect(toggle).toHaveAttribute('data-state', 'collapsed');
    });

    it('skips handoff parsing while collapsed and runs it on expand', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);

      expect(normalizeChatroomMarkdownContent).not.toHaveBeenCalled();
      expect(hasHandoffEnvelope).not.toHaveBeenCalled();
      expect(hasHandoffReport).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Show full handoff' }));

      expect(normalizeChatroomMarkdownContent).toHaveBeenCalled();
      expect(hasHandoffEnvelope).toHaveBeenCalled();
      expect(hasHandoffReport).toHaveBeenCalled();
    });

    it('previews presentation-fenced handoff content instead of rendering nothing', () => {
      const fencedHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '```markdown\n## Summary\nFixed the thing.\n```',
      };
      render(<TimelineTeamMessage message={fencedHandoff} chatroomId="room-1" collapsible />);

      expect(
        within(screen.getByTestId('timeline-handoff-toggle')).getByTestId(
          'timeline-handoff-preview'
        )
      ).toHaveTextContent('Summary Fixed the thing.');
    });

    it('shows the visible label and no describedby when the preview is empty', () => {
      const blankHandoff: Message = { ...COLLAPSIBLE_HANDOFF, content: '   \n\n  ' };
      render(<TimelineTeamMessage message={blankHandoff} chatroomId="room-1" collapsible />);
      const toggle = screen.getByTestId('timeline-handoff-toggle');

      expect(within(toggle).queryByTestId('timeline-handoff-preview')).not.toBeInTheDocument();
      expect(within(toggle).getByText('Show full handoff')).toBeInTheDocument();
      expect(toggle).not.toHaveAttribute('aria-describedby');
    });

    it('mounts the body and footer on expand and unmounts both on collapse', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);

      fireEvent.click(screen.getByRole('button', { name: 'Show full handoff' }));

      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Deferred body sentence.'
      );
      expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
      expect(screen.queryByTestId('timeline-handoff-preview')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-team-message')).toHaveAttribute(
        'data-message-type',
        'handoff'
      );

      fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));

      expect(screen.queryByTestId('timeline-markdown-body')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show full handoff' })).toBeInTheDocument();
    });

    it('keeps one toggle button focused and wired to the body across expand and collapse', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);

      const toggle = screen.getByTestId('timeline-handoff-toggle');
      const bodyId = toggle.getAttribute('aria-controls');
      expect(bodyId).toBeTruthy();
      expect(document.getElementById(bodyId as string)).toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      toggle.focus();
      fireEvent.click(toggle);

      const expandedToggle = screen.getByTestId('timeline-handoff-toggle');
      expect(expandedToggle).toBe(toggle);
      expect(expandedToggle).toHaveAttribute('aria-expanded', 'true');
      expect(expandedToggle).toHaveTextContent('Collapse');
      expect(document.activeElement).toBe(expandedToggle);
      expect(document.getElementById(bodyId as string)).toContainElement(
        screen.getByTestId('timeline-markdown-body')
      );
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      fireEvent.click(expandedToggle);

      const collapsedToggle = screen.getByTestId('timeline-handoff-toggle');
      expect(collapsedToggle).toBe(toggle);
      expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(collapsedToggle);
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('does not scroll the feed when collapsing', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);

      fireEvent.click(screen.getByTestId('timeline-handoff-toggle'));
      scrollIntoViewMock.mockClear();

      fireEvent.click(screen.getByTestId('timeline-handoff-toggle'));

      expect(screen.getByTestId('timeline-handoff-preview')).toBeInTheDocument();
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('describes itself with the preview and names both actions', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);
      const toggle = screen.getByTestId('timeline-handoff-toggle');
      const preview = within(toggle).getByTestId('timeline-handoff-preview');

      expect(toggle).toHaveAttribute('aria-describedby', preview.id);
      expect(toggle).toHaveAccessibleName('Show full handoff');

      fireEvent.click(toggle);

      expect(toggle).toHaveAccessibleName('Collapse');
      expect(toggle).not.toHaveAttribute('aria-describedby');
    });

    it('flips data-state and rotates the same chevron when expanded', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);
      const toggle = screen.getByTestId('timeline-handoff-toggle');
      const chevron = toggle.querySelector('svg');

      expect(toggle).toHaveAttribute('data-state', 'collapsed');
      expect(chevron).not.toBeNull();
      expect(chevron).not.toHaveClass('rotate-90');

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute('data-state', 'expanded');
      expect(toggle.querySelector('svg')).toBe(chevron);
      expect(chevron).toHaveClass('rotate-90');
    });

    it('shows the code-block placeholder for code-only content', () => {
      const codeHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '```ts\nconst a = 1;\n```',
      };
      render(<TimelineTeamMessage message={codeHandoff} chatroomId="room-1" collapsible />);

      expect(
        within(screen.getByTestId('timeline-handoff-toggle')).getByTestId(
          'timeline-handoff-preview'
        )
      ).toHaveTextContent('(code block)');
    });

    it('clamps a long preview to two lines and 240 characters', () => {
      const longHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: 'word '.repeat(120).trim(),
      };
      render(<TimelineTeamMessage message={longHandoff} chatroomId="room-1" collapsible />);

      const preview = within(screen.getByTestId('timeline-handoff-toggle')).getByTestId(
        'timeline-handoff-preview'
      );
      expect(preview).toHaveClass('line-clamp-2');
      expect(preview.textContent?.length ?? 0).toBeLessThanOrEqual(240);
      expect(preview.textContent?.endsWith('…')).toBe(true);
    });

    it('moves the duration from the summary bar into the footer on expand', () => {
      render(
        <TimelineTeamMessage
          message={COLLAPSIBLE_HANDOFF}
          chatroomId="room-1"
          handoffDurationMs={62_000}
          collapsible
        />
      );

      const toggle = screen.getByTestId('timeline-handoff-toggle');
      const collapsedDuration = within(toggle).getByTestId('timeline-handoff-duration');
      expect(collapsedDuration).toHaveTextContent('1m 2s');
      expect(collapsedDuration).toHaveClass('hidden', 'sm:inline');
      expect(screen.getAllByTestId('timeline-handoff-duration')).toHaveLength(1);

      fireEvent.click(toggle);

      const footer = screen.getByTestId('timeline-message-footer');
      const expandedDuration = within(footer).getByTestId('timeline-handoff-duration');
      expect(expandedDuration).toHaveTextContent('1m 2s');
      expect(expandedDuration).not.toHaveClass('hidden');
      expect(screen.getAllByTestId('timeline-handoff-duration')).toHaveLength(1);
    });

    it('renders attachment chips under the bar when collapsed', () => {
      const withAttachments: Message = {
        ...COLLAPSIBLE_HANDOFF,
        attachedTasks: [{ _id: 'task-1', content: 'Attached task' }],
      };
      render(<TimelineTeamMessage message={withAttachments} chatroomId="room-1" collapsible />);

      const row = screen.getByTestId('timeline-team-message');
      const chipsWrapper = row.querySelector('.pl-\\[2\\.375rem\\]');
      expect(chipsWrapper).not.toBeNull();
      expect(chipsWrapper).toHaveTextContent('Attached task');
      expect(screen.queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
    });

    it('toggles with Enter and Space and keeps focus on the same button', async () => {
      const user = userEvent.setup();
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />);
      const toggle = screen.getByTestId('timeline-handoff-toggle');

      await user.tab();
      expect(document.activeElement).toBe(toggle);

      await user.keyboard('{Enter}');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(document.activeElement).toBe(toggle);

      scrollIntoViewMock.mockClear();
      await user.keyboard(' ');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(toggle);
      expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('drops the header margin for collapsible rows and keeps eager rows unchanged', () => {
      const { unmount } = render(
        <TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" collapsible />
      );
      expect(screen.getByTestId('timeline-message-header')).not.toHaveClass('mb-2');
      unmount();

      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" />);

      expect(screen.getByTestId('timeline-message-header')).toHaveClass('mb-2');
      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Deferred body sentence.'
      );
      expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-team-message').querySelector('.py-3')).not.toBeNull();
      expect(screen.queryByText('Show full handoff')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-handoff-toggle')).not.toBeInTheDocument();
    });
  });
});
