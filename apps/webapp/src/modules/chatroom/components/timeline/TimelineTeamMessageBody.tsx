'use client';

import { memo } from 'react';

import { HandoffEnvelopeView } from './HandoffEnvelopeView';
import { HandoffReportView } from './HandoffReportView';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import type { Message } from '../../types/message';
import {
  normalizeChatroomMarkdownContent,
  unwrapMarkdownPresentationFence,
} from '../../utils/normalizeChatroomMarkdownContent';
import { hasHandoffEnvelope } from '../../utils/parseHandoffEnvelope';
import { hasHandoffReport } from '../../utils/parseHandoffReport';

type TeamMessageBodyView = 'envelope' | 'report' | 'markdown';

/** Selects the handoff-specific view; non-handoff messages always use markdown. */
function selectBodyView(message: Message, renderContent: string): TeamMessageBodyView {
  if (message.type !== 'handoff') return 'markdown';
  if (hasHandoffEnvelope(renderContent)) return 'envelope';
  if (hasHandoffReport(renderContent)) return 'report';
  return 'markdown';
}

/**
 * Full team-message body: handoff envelope/report view, or plain markdown.
 *
 * Lives in its own component so collapsed rows can skip mounting it entirely —
 * markdown parsing, remark-gfm, and Shiki must not run until the user expands a
 * handoff. The view selection matches the pre-collapse render path exactly.
 */
export const TimelineTeamMessageBody = memo(function TimelineTeamMessageBody({
  message,
}: {
  message: Message;
}) {
  const renderContent =
    message.type === 'handoff'
      ? normalizeChatroomMarkdownContent(unwrapMarkdownPresentationFence(message.content))
      : message.content;
  const view = selectBodyView(message, renderContent);

  if (view === 'envelope') {
    return <HandoffEnvelopeView content={renderContent} variant="timeline" />;
  }
  if (view === 'report') {
    return (
      <HandoffReportView
        content={renderContent}
        variant="timeline"
        targetRole={message.targetRole}
      />
    );
  }
  return <TimelineMarkdownBody content={renderContent} />;
});
