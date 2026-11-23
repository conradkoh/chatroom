'use client';

import { memo } from 'react';

import {
  TIMELINE_HANDOFF_PREVIEW_TEXT,
  TIMELINE_HANDOFF_TRIGGER_LABEL,
  TIMELINE_PLAN_SUMMARY_COLUMN,
  TIMELINE_PLAN_SUMMARY_COUNT,
  TIMELINE_PLAN_SUMMARY_PHASE_ID,
  TIMELINE_PLAN_SUMMARY_PHASES,
  TIMELINE_PLAN_SUMMARY_TITLE,
} from './timelineRowStyles';
import type { PlanSummary } from '../../timeline/planSummary';

export interface TimelinePlanSummaryProps {
  summary: PlanSummary;
  /** Id of the element that `aria-describedby` on the bar points at. */
  previewId: string;
}

/** Fallback content: the plain-text preview, or the empty-content label. No markdown. */
function PlanSummaryFallback({ text, previewId }: { text: string; previewId: string }) {
  if (!text) {
    return <span className={TIMELINE_HANDOFF_TRIGGER_LABEL}>Show full plan</span>;
  }
  return (
    <span
      id={previewId}
      data-testid="timeline-plan-preview-fallback"
      className={TIMELINE_HANDOFF_PREVIEW_TEXT}
    >
      {text}
    </span>
  );
}

/** Phase overview line: count prefix, the listed phases, then the hidden remainder. */
function PlanPhaseOverview({
  summary,
  previewId,
}: {
  summary: Extract<PlanSummary, { kind: 'structured' }>;
  previewId: string;
}) {
  return (
    <span
      id={previewId}
      data-testid="timeline-plan-summary-phases"
      className={TIMELINE_PLAN_SUMMARY_PHASES}
    >
      <span className={TIMELINE_PLAN_SUMMARY_COUNT}>
        {summary.phaseCount} {summary.phaseCount === 1 ? 'phase' : 'phases'}
      </span>
      {summary.phases.map((phase, index) => (
        <span key={phase.id}>
          {index > 0 && <span aria-hidden="true"> · </span>}
          <span className={TIMELINE_PLAN_SUMMARY_PHASE_ID}>{phase.id}</span> {phase.title}
        </span>
      ))}
      {summary.hiddenPhaseCount > 0 && <span> · +{summary.hiddenPhaseCount} more</span>}
    </span>
  );
}

/**
 * Content region of the collapsed plan bar: title over a plain-text phase overview.
 * No markdown and no interactive children — the bar itself is the only control.
 */
export const TimelinePlanSummary = memo(function TimelinePlanSummary({
  summary,
  previewId,
}: TimelinePlanSummaryProps) {
  if (summary.kind === 'fallback') {
    return <PlanSummaryFallback text={summary.text} previewId={previewId} />;
  }

  return (
    <span className={TIMELINE_PLAN_SUMMARY_COLUMN}>
      <span data-testid="timeline-plan-summary-title" className={TIMELINE_PLAN_SUMMARY_TITLE}>
        {summary.title}
      </span>
      <PlanPhaseOverview summary={summary} previewId={previewId} />
    </span>
  );
});
