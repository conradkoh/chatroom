'use client';

import type { ParsedPhase } from '@workspace/backend/src/domain/plan/parse-plan';
import { ArrowUp } from 'lucide-react';
import { memo, type MouseEvent } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { jumpToPlanAnchor, planAnchorId, planPhaseRef } from './timelinePlanAnchors';
import { TimelinePlanCopyButton } from './TimelinePlanCopyButton';
import { toPlanMarkdownList } from './timelinePlanMarkdown';
import {
  TIMELINE_PLAN_CONTROL,
  TIMELINE_PLAN_FOCUS,
  TIMELINE_PLAN_LABEL,
} from './timelineRowStyles';

import { cn } from '@/lib/utils';

/** Phase count at which the index switches to two columns (only inside a ≥ @xl container). */
const TWO_COLUMN_MIN_PHASES = 8;

/** Click/Enter on an in-row link: keep the URL hash untouched and jump inside the row. */
function jumpOnClick(targetId: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    jumpToPlanAnchor(targetId);
  };
}

interface CopyHandlers {
  copiedKey: string | null;
  failedKey: string | null;
  onCopy: (text: string, key: string) => void;
}

interface PhaseCopyButtonProps extends CopyHandlers {
  testId: string;
  messageId: string;
  phaseId: string;
}

/** Copy control for a phase reference; one per index entry and one per detail block. */
function PhaseCopyButton({
  testId,
  messageId,
  phaseId,
  copiedKey,
  failedKey,
  onCopy,
}: PhaseCopyButtonProps) {
  return (
    <TimelinePlanCopyButton
      testId={testId}
      label={`Copy ${phaseId} reference`}
      copied={copiedKey === phaseId}
      failed={failedKey === phaseId}
      onCopy={() => onCopy(planPhaseRef(messageId, phaseId), phaseId)}
      className="h-8 w-8 justify-center @xl:h-7 @xl:w-7"
    />
  );
}

export interface TimelinePlanPhaseIndexProps extends CopyHandlers {
  messageId: string;
  phases: readonly Pick<ParsedPhase, 'id' | 'title'>[];
}

/**
 * Index of every phase: one jump link and one copy control per phase. The copy
 * control writes the unambiguous `<planId>#Pn` reference.
 */
export const TimelinePlanPhaseIndex = memo(function TimelinePlanPhaseIndex({
  messageId,
  phases,
  copiedKey,
  failedKey,
  onCopy,
}: TimelinePlanPhaseIndexProps) {
  const indexId = planAnchorId(messageId, 'phases');
  const twoColumns = phases.length >= TWO_COLUMN_MIN_PHASES;
  return (
    <section data-testid="timeline-plan-phase-index" className="min-w-0">
      <h4
        id={indexId}
        tabIndex={-1}
        className={cn('mb-1', TIMELINE_PLAN_LABEL, TIMELINE_PLAN_FOCUS)}
      >
        Phases · {phases.length}
      </h4>
      <ol className={cn('m-0 list-none p-0', twoColumns && '@xl:columns-2 @xl:gap-x-6')}>
        {phases.map((phase) => {
          const anchor = planAnchorId(messageId, phase.id);
          return (
            <li
              key={phase.id}
              className="flex min-h-8 items-center gap-1 break-inside-avoid @xl:min-h-7"
            >
              <a
                href={`#${anchor}`}
                onClick={jumpOnClick(anchor)}
                data-testid={`timeline-plan-phase-link-${phase.id}`}
                className={cn(
                  'flex min-w-0 flex-1 items-baseline gap-2 py-1 text-xs text-chatroom-text-secondary hover:text-chatroom-text-primary',
                  TIMELINE_PLAN_FOCUS
                )}
              >
                <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-chatroom-text-muted">
                  {phase.id}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{phase.title}</span>
              </a>
              <PhaseCopyButton
                testId={`timeline-plan-phase-copy-${phase.id}`}
                messageId={messageId}
                phaseId={phase.id}
                copiedKey={copiedKey}
                failedKey={failedKey}
                onCopy={onCopy}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
});

export interface TimelinePlanPhaseDetailProps extends CopyHandlers {
  messageId: string;
  phase: ParsedPhase;
  /** False for a one-phase plan: there is nothing to go back to. */
  showBackLink: boolean;
}

/** One phase's detail block: depends-on chips, requirements, constraints, acceptance. */
export const TimelinePlanPhaseDetail = memo(function TimelinePlanPhaseDetail({
  messageId,
  phase,
  showBackLink,
  copiedKey,
  failedKey,
  onCopy,
}: TimelinePlanPhaseDetailProps) {
  const headingId = planAnchorId(messageId, phase.id);
  const phasesId = planAnchorId(messageId, 'phases');
  return (
    <section
      id={`${headingId}-section`}
      data-testid={`timeline-plan-phase-${phase.id}`}
      className="min-w-0 border-t border-chatroom-border pt-3"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="bg-chatroom-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-chatroom-text-primary">
          {phase.id}
        </span>
        <h4
          id={headingId}
          tabIndex={-1}
          className={cn(
            'min-w-0 flex-1 text-sm font-bold text-chatroom-text-primary [overflow-wrap:anywhere]',
            TIMELINE_PLAN_FOCUS
          )}
        >
          {phase.title}
        </h4>
        <PhaseCopyButton
          testId={`timeline-plan-phase-detail-copy-${phase.id}`}
          messageId={messageId}
          phaseId={phase.id}
          copiedKey={copiedKey}
          failedKey={failedKey}
          onCopy={onCopy}
        />
        {showBackLink && (
          <a
            href={`#${phasesId}`}
            onClick={jumpOnClick(phasesId)}
            data-testid="timeline-plan-back-to-phases"
            className={cn(
              TIMELINE_PLAN_CONTROL,
              'h-8 px-1.5 text-[10px] font-bold uppercase tracking-wider @xl:h-7'
            )}
          >
            <ArrowUp size={12} aria-hidden="true" />
            Phases
          </a>
        )}
      </header>
      <div className="mt-2 min-w-0 space-y-2 border-l-2 border-chatroom-border pl-3">
        {phase.dependsOn.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className={TIMELINE_PLAN_LABEL}>Depends on</span>
            {phase.dependsOn.map((dep) => {
              const anchor = planAnchorId(messageId, dep);
              return (
                <a
                  key={dep}
                  href={`#${anchor}`}
                  onClick={jumpOnClick(anchor)}
                  data-testid={`timeline-plan-depends-${phase.id}-${dep}`}
                  className={cn(
                    'bg-chatroom-bg-tertiary px-1 py-0.5 font-mono text-[10px] font-bold tabular-nums text-chatroom-text-secondary hover:text-chatroom-text-primary',
                    TIMELINE_PLAN_FOCUS
                  )}
                >
                  {dep}
                </a>
              );
            })}
          </div>
        )}
        <PhaseListBlock label="Requirements" items={phase.requirements} />
        <PhaseListBlock label="Constraints" items={phase.constraints} />
        <PhaseListBlock label="Acceptance criteria" items={phase.acceptance} />
      </div>
    </section>
  );
});

/** A per-phase bullet list; an empty list renders the template's muted `None`. */
function PhaseListBlock({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="min-w-0">
      <p className={cn(TIMELINE_PLAN_LABEL, 'mb-1')}>{label}</p>
      {items.length === 0 ? (
        <p className="text-xs italic text-chatroom-text-muted">None</p>
      ) : (
        <TimelineMarkdownBody content={toPlanMarkdownList(items)} />
      )}
    </div>
  );
}
