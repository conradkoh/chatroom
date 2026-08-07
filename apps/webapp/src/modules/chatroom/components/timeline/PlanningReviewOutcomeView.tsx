'use client';

import { memo, useMemo } from 'react';

import { HandoffReportView } from './HandoffReportView';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { BADGE_BASE } from './timelineRowStyles';
import { hasHandoffReport } from '../../utils/parseHandoffReport';
import {
  parsePlanningReviewOutcome,
  type PlanningReviewOutcomeStatus,
} from '../../utils/parsePlanningReviewOutcome';
import { stripHandoffXmlTags } from '../../utils/stripHandoffXmlTags';

import { cn } from '@/lib/utils';

export type PlanningReviewOutcomeViewVariant = 'timeline' | 'detail';

export interface PlanningReviewOutcomeViewProps {
  content: string;
  variant?: PlanningReviewOutcomeViewVariant;
}

interface BadgeStyle {
  className: string;
  label: string;
}

function badgeForStatus(status: PlanningReviewOutcomeStatus | null): BadgeStyle {
  switch (status) {
    case 'cancelled':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-warning/15 text-chatroom-status-warning`,
        label: 'cancelled',
      };
    case 'failed':
      return {
        className: `${BADGE_BASE} bg-chatroom-status-error/15 text-chatroom-status-error`,
        label: 'failed',
      };
    default:
      return {
        className: `${BADGE_BASE} bg-chatroom-status-info/15 text-chatroom-status-info`,
        label: 'review outcome',
      };
  }
}

export const PlanningReviewOutcomeView = memo(function PlanningReviewOutcomeView({
  content,
  variant = 'timeline',
}: PlanningReviewOutcomeViewProps) {
  const parsed = useMemo(() => parsePlanningReviewOutcome(content), [content]);
  const badge = badgeForStatus(parsed.status);
  const bodyContent = parsed.body ?? content;

  return (
    <div
      data-testid="planning-review-outcome-view"
      className={cn('space-y-2', variant === 'detail' && 'my-2')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={badge.className}>{badge.label}</span>
      </div>
      {hasHandoffReport(bodyContent) ? (
        <HandoffReportView content={bodyContent} variant={variant} />
      ) : (
        <TimelineMarkdownBody content={stripHandoffXmlTags(bodyContent)} />
      )}
    </div>
  );
});
