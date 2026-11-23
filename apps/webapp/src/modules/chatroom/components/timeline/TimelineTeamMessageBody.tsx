'use client';

import { memo } from 'react';

import { HandoffEnvelopeView } from './HandoffEnvelopeView';
import { HandoffReportView } from './HandoffReportView';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { TimelinePlanBody } from './TimelinePlanBody';
import type { Message } from '../../types/message';
import {
  normalizeChatroomMarkdownContent,
  unwrapMarkdownPresentationFence,
} from '../../utils/normalizeChatroomMarkdownContent';
import { hasHandoffEnvelope } from '../../utils/parseHandoffEnvelope';
import { hasHandoffReport } from '../../utils/parseHandoffReport';

type TeamMessageBodyView = 'envelope' | 'report' | 'markdown' | 'plan';

/** Handoff content shape: envelope first, then report, else plain markdown. */
function selectHandoffView(renderContent: string): TeamMessageBodyView {
  if (hasHandoffEnvelope(renderContent)) return 'envelope';
  return hasHandoffReport(renderContent) ? 'report' : 'markdown';
}

/** Selects the view. Plans render the structured plan body; handoffs select envelope/report; everything else is markdown. */
function selectBodyView(message: Message, renderContent: string): TeamMessageBodyView {
  if (message.type === 'plan') return 'plan';
  if (message.type !== 'handoff') return 'markdown';
  return selectHandoffView(renderContent);
}

/** Handoffs are normalized and unwrapped; every other type renders its stored content. */
function resolveRenderContent(message: Message): string {
  if (message.type !== 'handoff') return message.content;
  return normalizeChatroomMarkdownContent(unwrapMarkdownPresentationFence(message.content));
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
  const renderContent = resolveRenderContent(message);
  const view = selectBodyView(message, renderContent);

  if (view === 'plan') {
    return <TimelinePlanBody message={message} />;
  }
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
