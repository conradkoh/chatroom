import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineTeamMessage } from './TimelineTeamMessage';
import type * as AttachmentsModule from '../../attachments';
import type * as PreviewModule from '../../timeline/handoffPreview';
import { getHandoffPreviewText } from '../../timeline/handoffPreview';
import type { Message } from '../../types/message';
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

vi.mock('../../timeline/handoffPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof PreviewModule>();
  return { ...actual, getHandoffPreviewText: vi.fn(actual.getHandoffPreviewText) };
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

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(() => undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { fileAttachments: { getFileUrls: 'fileAttachments.getFileUrls' } },
}));

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

const FILE_ATTACHMENT_MESSAGE: Message = {
  ...BASE_MESSAGE,
  targetRole: 'user',
  attachedFiles: [
    {
      _id: 'attachment-1',
      status: 'available',
      filename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: 1536,
    },
  ] as Message['attachedFiles'],
};

const scrollIntoViewMock = vi.fn();
Element.prototype.scrollIntoView = scrollIntoViewMock;

beforeEach(() => {
  markdownBodyMock.mockClear();
  vi.mocked(normalizeChatroomMarkdownContent).mockClear();
  vi.mocked(hasHandoffEnvelope).mockClear();
  vi.mocked(hasHandoffReport).mockClear();
  vi.mocked(getHandoffPreviewText).mockClear();
  scrollIntoViewMock.mockClear();
  vi.mocked(useSessionQuery).mockImplementation(() => undefined);
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

  it('renders file attachment rows in the expanded state', () => {
    render(<TimelineTeamMessage message={FILE_ATTACHMENT_MESSAGE} chatroomId="room-1" />);

    expect(screen.getByTestId('message-file-attachments')).toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB · PNG')).toBeInTheDocument();
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
          handoffDurationSlow
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

    /** Same body, but from the planner with no target, so the dialog name is "…from planner". */
    const PLANNER_HANDOFF: Message = {
      ...BASE_MESSAGE,
      content: 'Planner preview line.\n\nDeferred body sentence.',
    };

    const collapsible = (message: Message = COLLAPSIBLE_HANDOFF, durationMs?: number) => (
      <TimelineTeamMessage
        message={message}
        chatroomId="room-1"
        handoffDurationMs={durationMs}
        collapsible
      />
    );

    const openDialog = () => fireEvent.click(screen.getByTestId('timeline-handoff-trigger'));

    it('starts collapsed as a dialog trigger and renders no body, footer or dialog', () => {
      const { container } = render(collapsible());
      const trigger = screen.getByTestId('timeline-handoff-trigger');
      const preview = within(trigger).getByTestId('timeline-handoff-preview');

      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      expect(trigger).toHaveAccessibleName('Show full handoff');
      expect(trigger).toHaveAttribute('title', 'Show full handoff');
      expect(trigger).toHaveAttribute('aria-describedby', preview.id);
      expect(trigger).not.toHaveAttribute('aria-expanded');
      expect(trigger).not.toHaveAttribute('aria-controls');
      expect(trigger).not.toHaveAttribute('data-state');
      expect(screen.queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(container.querySelector('.prose')).toBeNull();
      expect(screen.queryByText(/Deferred body sentence/)).not.toBeInTheDocument();
    });

    it('does not parse or mount markdown until the dialog is first opened', () => {
      render(collapsible());

      expect(markdownBodyMock).not.toHaveBeenCalled();
      expect(normalizeChatroomMarkdownContent).not.toHaveBeenCalled();
      expect(hasHandoffEnvelope).not.toHaveBeenCalled();
      expect(hasHandoffReport).not.toHaveBeenCalled();
      expect(screen.queryByTestId('timeline-markdown-body')).not.toBeInTheDocument();

      openDialog();

      expect(markdownBodyMock).toHaveBeenCalled();
      expect(normalizeChatroomMarkdownContent).toHaveBeenCalled();
      expect(hasHandoffEnvelope).toHaveBeenCalled();
      expect(hasHandoffReport).toHaveBeenCalled();
    });

    it('opens a dialog named after the handoff with the body, footer and duration', () => {
      render(collapsible(PLANNER_HANDOFF, 62_000));

      openDialog();

      const dialog = screen.getByRole('dialog', { name: 'Full handoff from planner' });
      expect(dialog).toHaveAccessibleDescription(/Sent .*Time since previous message/);
      expect(within(dialog).getByTestId('timeline-handoff-dialog-body')).toBeInTheDocument();
      expect(within(dialog).getByTestId('timeline-message-footer')).toBeInTheDocument();
      expect(within(dialog).getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Deferred body sentence.'
      );
      expect(within(dialog).getByTestId('timeline-handoff-duration')).toHaveTextContent('1m 2s');
      expect(within(dialog).getByTestId('timeline-handoff-duration')).toHaveAttribute(
        'title',
        'Time since previous message: 1m 2s'
      );
    });

    it('opens with Enter and reopens with Space', async () => {
      const user = userEvent.setup();
      render(collapsible(PLANNER_HANDOFF));
      const trigger = screen.getByTestId('timeline-handoff-trigger');

      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('dialog', { name: 'Full handoff from planner' })).toBeInTheDocument();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      trigger.focus();
      await user.keyboard(' ');
      expect(screen.getByRole('dialog', { name: 'Full handoff from planner' })).toBeInTheDocument();
    });

    it('closes on Escape and on the header close button, and can reopen', async () => {
      const user = userEvent.setup();
      render(collapsible());

      openDialog();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByTestId('timeline-handoff-dialog-body')).toBeNull());

      openDialog();
      fireEvent.click(screen.getByTestId('timeline-handoff-dialog-close'));
      await waitFor(() => expect(screen.queryByTestId('timeline-handoff-dialog-body')).toBeNull());

      openDialog();
      expect(screen.getByTestId('timeline-handoff-dialog-body')).toBeInTheDocument();
    });

    it('shows the empty-content label and attachments in the dialog for blank content', () => {
      const emptyWithFiles: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '   \n\n  ',
        attachedTasks: [{ _id: 'task-1', content: 'Attached task' }],
        attachedFiles: FILE_ATTACHMENT_MESSAGE.attachedFiles,
      };
      render(collapsible(emptyWithFiles));

      openDialog();

      const dialog = screen.getByRole('dialog', {
        name: 'Full handoff from builder to planner',
      });
      expect(within(dialog).getByTestId('timeline-handoff-dialog-empty')).toHaveTextContent(
        'No text content in this handoff.'
      );
      expect(within(dialog).getByText('Attached task')).toBeInTheDocument();
      expect(within(dialog).getByText('shot.png')).toBeInTheDocument();
      expect(within(dialog).queryByTestId('timeline-markdown-body')).not.toBeInTheDocument();
    });

    it('renders attachment chips in both the bar and the dialog for attachments-only content', () => {
      const attachmentsOnly: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '   \n\n  ',
        attachedTasks: [{ _id: 'task-1', content: 'Attached task' }],
      };
      render(collapsible(attachmentsOnly));

      const bar = screen.getByTestId('timeline-handoff-trigger');
      expect(
        within(bar.parentElement as HTMLElement).getByText('Attached task')
      ).toBeInTheDocument();

      openDialog();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Attached task')).toBeInTheDocument();
      expect(screen.getAllByText('Attached task')).toHaveLength(2);
    });

    it('shows the code-block placeholder for code-only content and the fence in the dialog', () => {
      const codeHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '```ts\nconst a = 1;\n```',
      };
      render(collapsible(codeHandoff));

      expect(
        within(screen.getByTestId('timeline-handoff-trigger')).getByTestId(
          'timeline-handoff-preview'
        )
      ).toHaveTextContent('(code block)');

      openDialog();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByTestId('timeline-markdown-body')).toHaveTextContent(
        'const a = 1;'
      );
    });

    it('keeps the slow duration tone in the bar and in the dialog footer', () => {
      render(
        <TimelineTeamMessage
          message={COLLAPSIBLE_HANDOFF}
          chatroomId="room-1"
          handoffDurationMs={420_000}
          handoffDurationSlow
          collapsible
        />
      );

      const barDuration = within(screen.getByTestId('timeline-handoff-trigger')).getByTestId(
        'timeline-handoff-duration'
      );
      expect(barDuration).toHaveAttribute('data-duration-tone', 'slow');
      expect(barDuration).toHaveClass('text-chatroom-status-slow');

      openDialog();

      const dialog = screen.getByRole('dialog');
      const footer = within(dialog).getByTestId('timeline-message-footer');
      const footerDuration = within(footer).getByTestId('timeline-handoff-duration');
      expect(footerDuration).toHaveAttribute('data-duration-tone', 'slow');
      expect(footerDuration).toHaveTextContent('7m 0s');
    });

    it('leaves an eager row inline with no trigger and no dialog', () => {
      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" />);

      expect(screen.queryByTestId('timeline-handoff-trigger')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Deferred body sentence.'
      );
      expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
      expect(screen.queryByText('Show full handoff')).not.toBeInTheDocument();
    });

    it('computes the preview only for collapsible rows', () => {
      const { unmount } = render(
        <TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" />
      );
      expect(getHandoffPreviewText).not.toHaveBeenCalled();
      unmount();

      render(collapsible());
      expect(getHandoffPreviewText).toHaveBeenCalledTimes(1);

      openDialog();
      expect(getHandoffPreviewText).toHaveBeenCalledTimes(1);
    });

    it('does not scroll the document, elements or the feed when opening or closing', () => {
      // jsdom does not implement Element.prototype.scrollTo; install both spies as stubs.
      const elementScrollTo = vi.fn();
      const originalElementScrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = elementScrollTo;
      const windowScrollTo = vi.fn();
      const originalWindowScrollTo = window.scrollTo;
      window.scrollTo = windowScrollTo;
      try {
        render(collapsible());

        openDialog();
        fireEvent.click(screen.getByTestId('timeline-handoff-dialog-close'));

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
        expect(elementScrollTo).not.toHaveBeenCalled();
        expect(windowScrollTo).not.toHaveBeenCalled();
      } finally {
        if (originalElementScrollTo) {
          Element.prototype.scrollTo = originalElementScrollTo;
        } else {
          delete (Element.prototype as unknown as Record<string, unknown>).scrollTo;
        }
        window.scrollTo = originalWindowScrollTo;
      }
    });

    it('renders no header navigation inside the dialog', () => {
      render(
        <TimelineTeamMessage
          message={COLLAPSIBLE_HANDOFF}
          chatroomId="room-1"
          collapsible
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
      expect(screen.getByTestId('timeline-header-nav-current')).toBeInTheDocument();

      openDialog();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByTestId('timeline-header-nav-current')).toBeNull();
      expect(screen.getByTestId('timeline-header-nav-current')).toBeInTheDocument();
    });

    it('shows the visible label and no describedby when the preview is empty', () => {
      const blankHandoff: Message = { ...COLLAPSIBLE_HANDOFF, content: '   \n\n  ' };
      render(collapsible(blankHandoff));
      const trigger = screen.getByTestId('timeline-handoff-trigger');

      expect(within(trigger).queryByTestId('timeline-handoff-preview')).not.toBeInTheDocument();
      expect(within(trigger).getByText('Show full handoff')).toBeInTheDocument();
      expect(trigger).not.toHaveAttribute('aria-describedby');
    });

    it('previews presentation-fenced handoff content instead of rendering nothing', () => {
      const fencedHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: '```markdown\n## Summary\nFixed the thing.\n```',
      };
      render(collapsible(fencedHandoff));

      expect(
        within(screen.getByTestId('timeline-handoff-trigger')).getByTestId(
          'timeline-handoff-preview'
        )
      ).toHaveTextContent('Summary Fixed the thing.');
    });

    it('clamps a long preview to two lines and 240 characters', () => {
      const longHandoff: Message = {
        ...COLLAPSIBLE_HANDOFF,
        content: 'word '.repeat(120).trim(),
      };
      render(collapsible(longHandoff));

      const preview = within(screen.getByTestId('timeline-handoff-trigger')).getByTestId(
        'timeline-handoff-preview'
      );
      expect(preview).toHaveClass('line-clamp-2');
      expect(preview.textContent?.length ?? 0).toBeLessThanOrEqual(240);
      expect(preview.textContent?.endsWith('…')).toBe(true);
    });

    it('renders attachment chips under the bar when collapsed', () => {
      const withAttachments: Message = {
        ...COLLAPSIBLE_HANDOFF,
        attachedTasks: [{ _id: 'task-1', content: 'Attached task' }],
      };
      render(collapsible(withAttachments));

      const row = screen.getByTestId('timeline-team-message');
      const chipsWrapper = row.querySelector('.pl-\\[2\\.375rem\\]');
      expect(chipsWrapper).not.toBeNull();
      expect(chipsWrapper).toHaveTextContent('Attached task');
      expect(screen.queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
    });

    it('renders file attachment rows under the bar when collapsed without media', () => {
      render(
        <TimelineTeamMessage message={FILE_ATTACHMENT_MESSAGE} chatroomId="room-1" collapsible />
      );

      expect(screen.getByTestId('message-file-attachments')).toBeInTheDocument();
      expect(screen.getByText('shot.png')).toBeInTheDocument();
      expect(screen.queryByAltText('shot.png')).not.toBeInTheDocument();
    });

    it('shows the image in the dialog but not on the bar, because the row passes showMedia only to the dialog', () => {
      const url = 'https://files.example/shot.png';
      vi.mocked(useSessionQuery).mockImplementation(() => [{ attachmentId: 'attachment-1', url }]);
      render(
        collapsible({
          ...COLLAPSIBLE_HANDOFF,
          attachedFiles: FILE_ATTACHMENT_MESSAGE.attachedFiles,
        })
      );

      const row = screen.getByTestId('timeline-team-message');
      expect(within(row).getByText('shot.png')).toBeInTheDocument();
      expect(within(row).queryByAltText('shot.png')).not.toBeInTheDocument();

      openDialog();

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByAltText('shot.png')).toHaveAttribute('src', url);
    });

    it('drops the header margin for collapsible rows and keeps eager rows unchanged', () => {
      const { unmount } = render(collapsible());
      expect(screen.getByTestId('timeline-message-header')).not.toHaveClass('mb-2');
      unmount();

      render(<TimelineTeamMessage message={COLLAPSIBLE_HANDOFF} chatroomId="room-1" />);

      expect(screen.getByTestId('timeline-message-header')).toHaveClass('mb-2');
      expect(screen.getByTestId('timeline-markdown-body')).toHaveTextContent(
        'Deferred body sentence.'
      );
      expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-team-message').querySelector('.py-3')).not.toBeNull();
    });
  });
});
