'use client';

import { parsePlan, type ParsedPlan } from '@workspace/backend/src/domain/plan/parse-plan';
import { memo, useCallback, useMemo } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { shortPlanId } from './timelinePlanAnchors';
import { TimelinePlanCopyButton } from './TimelinePlanCopyButton';
import { toPlanMarkdownList } from './timelinePlanMarkdown';
import { TimelinePlanPhaseDetail, TimelinePlanPhaseIndex } from './TimelinePlanPhases';
import { TIMELINE_PLAN_LABEL } from './timelineRowStyles';
import type { Message } from '../../types/message';

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { cn } from '@/lib/utils';

/** Parse failure and thrown exceptions both return null: the caller falls back to raw markdown. */
function readPlan(content: string): ParsedPlan | null {
  try {
    const result = parsePlan(content);
    return result.ok ? result.plan : null;
  } catch {
    return null;
  }
}

interface CopyHandlers {
  copiedKey: string | null;
  failedKey: string | null;
  onCopy: (text: string, key: string) => void;
}

/** Plan id chip (+ Supersedes chip when present). Full ids are in the `title` tooltip. */
function PlanIdControls({
  messageId,
  supersedesPlanId,
  copiedKey,
  failedKey,
  onCopy,
}: CopyHandlers & { messageId: string; supersedesPlanId?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-chatroom-text-muted">
      <span className="inline-flex items-center gap-1">
        <TimelinePlanCopyButton
          testId="timeline-plan-id-copy"
          label="Copy plan id"
          text="Plan ID"
          copied={copiedKey === 'plan'}
          failed={failedKey === 'plan'}
          onCopy={() => onCopy(messageId, 'plan')}
          className="-ml-1.5 h-6 px-1.5"
        />
        <span title={messageId} className="font-mono tabular-nums">
          {shortPlanId(messageId)}
        </span>
      </span>
      {supersedesPlanId && (
        <span className="inline-flex items-center gap-1">
          <TimelinePlanCopyButton
            testId="timeline-plan-supersedes"
            label="Copy superseded plan id"
            text="Supersedes"
            copied={copiedKey === 'supersedes'}
            failed={failedKey === 'supersedes'}
            onCopy={() => onCopy(supersedesPlanId, 'supersedes')}
            className="-ml-1.5 h-6 px-1.5"
          />
          <span title={supersedesPlanId} className="font-mono tabular-nums">
            {shortPlanId(supersedesPlanId)}
          </span>
        </span>
      )}
    </div>
  );
}

/** Plan-level labelled list. An empty list renders the muted "None" the template allows. */
function PlanListSection({
  label,
  items,
  muted = false,
}: {
  label: string;
  items: readonly string[];
  muted?: boolean;
}) {
  return (
    <section className="min-w-0">
      <h4 className={cn(TIMELINE_PLAN_LABEL, 'mb-1')}>{label}</h4>
      <div className={cn('min-w-0', muted && 'text-chatroom-text-secondary')}>
        {items.length === 0 ? (
          <p className="text-xs italic text-chatroom-text-muted">None</p>
        ) : (
          <TimelineMarkdownBody content={toPlanMarkdownList(items)} />
        )}
      </div>
    </section>
  );
}

interface PlanHeaderProps extends CopyHandlers {
  message: Message;
  plan: ParsedPlan;
}

/** Title plus the meta line: copyable plan id, optional supersedes id, phase count. */
function PlanHeader({ message, plan, copiedKey, failedKey, onCopy }: PlanHeaderProps) {
  const supersedesPlanId = message.supersedesPlanId?.trim() ? message.supersedesPlanId : undefined;
  return (
    <header className="min-w-0 space-y-1">
      <h3
        data-testid="timeline-plan-title"
        className="text-base font-bold leading-snug text-chatroom-text-primary [overflow-wrap:anywhere]"
      >
        {plan.title}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-chatroom-text-muted">
        <PlanIdControls
          messageId={message._id}
          supersedesPlanId={supersedesPlanId}
          copiedKey={copiedKey}
          failedKey={failedKey}
          onCopy={onCopy}
        />
        <span className="tabular-nums">
          {plan.phases.length} {plan.phases.length === 1 ? 'phase' : 'phases'}
        </span>
      </div>
    </header>
  );
}

interface PlanContentProps extends CopyHandlers {
  message: Message;
  plan: ParsedPlan;
}

/** Valid plan: header → phase index → Requirements → Constraints → Sources → details → Remarks. */
function PlanContent({ message, plan, copiedKey, failedKey, onCopy }: PlanContentProps) {
  const copyProps = { copiedKey, failedKey, onCopy };
  return (
    <>
      <PlanHeader message={message} plan={plan} {...copyProps} />
      <TimelinePlanPhaseIndex messageId={message._id} phases={plan.phases} {...copyProps} />
      <PlanListSection label="Requirements" items={plan.requirements} />
      <PlanListSection label="Constraints" items={plan.constraints} />
      <PlanListSection label="Sources" items={plan.sources} muted />
      <section className="min-w-0 space-y-4">
        <h4 className={TIMELINE_PLAN_LABEL}>Phase details</h4>
        {plan.phases.map((phase) => (
          <TimelinePlanPhaseDetail
            key={phase.id}
            messageId={message._id}
            phase={phase}
            showBackLink={plan.phases.length > 1}
            {...copyProps}
          />
        ))}
      </section>
      {plan.remarks !== null && (
        <section className="min-w-0">
          <h4 className={cn(TIMELINE_PLAN_LABEL, 'mb-1')}>Remarks</h4>
          <TimelineMarkdownBody content={plan.remarks} />
        </section>
      )}
    </>
  );
}

interface PlanFallbackProps extends CopyHandlers {
  message: Message;
}

/** Blank or unparsable content: keep the id copyable, never render blank, never throw. */
function PlanFallback({ message, copiedKey, failedKey, onCopy }: PlanFallbackProps) {
  const supersedesPlanId = message.supersedesPlanId?.trim() ? message.supersedesPlanId : undefined;
  return (
    <>
      <PlanIdControls
        messageId={message._id}
        supersedesPlanId={supersedesPlanId}
        copiedKey={copiedKey}
        failedKey={failedKey}
        onCopy={onCopy}
      />
      {message.content.trim() === '' ? (
        <p className="text-xs italic text-chatroom-text-muted">No plan content.</p>
      ) : (
        <div data-testid="timeline-plan-fallback" className="min-w-0 space-y-2">
          <p className="text-[10px] text-chatroom-text-muted">
            Plan did not match the template. Showing raw markdown.
          </p>
          <TimelineMarkdownBody content={message.content} />
        </div>
      )}
    </>
  );
}

/**
 * Structured body of a `type: 'plan'` message. Parses the raw content once, owns the
 * single copy-feedback hook, and falls back to the raw markdown on parse failure.
 */
export const TimelinePlanBody = memo(function TimelinePlanBody({ message }: { message: Message }) {
  const plan = useMemo(() => readPlan(message.content), [message.content]);
  const { copiedKey, failedKey, copy } = useCopyToClipboard();
  const onCopy = useCallback(
    (text: string, key: string) => {
      void copy(text, key);
    },
    [copy]
  );
  const copyProps = { copiedKey, failedKey, onCopy };

  return (
    <div
      data-testid="timeline-plan-body"
      className="@container min-w-0 space-y-4 border-l-2 border-chatroom-border-strong pl-3"
    >
      {plan ? (
        <PlanContent message={message} plan={plan} {...copyProps} />
      ) : (
        <PlanFallback message={message} {...copyProps} />
      )}
    </div>
  );
});
