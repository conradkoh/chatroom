import { getHandoffPreviewText } from './handoffPreview';
import { readPlan } from './readPlan';

/** Phases listed in the collapsed bar before "+K more". */
// fallow-ignore-next-line unused-export
export const PLAN_SUMMARY_MAX_PHASES = 4;

export type PlanSummary =
  | {
      kind: 'structured';
      title: string;
      phaseCount: number;
      phases: { id: string; title: string }[]; // first PLAN_SUMMARY_MAX_PHASES
      hiddenPhaseCount: number; // phaseCount - phases.length
    }
  | { kind: 'fallback'; text: string }; // text '' => the bar renders the "Show full plan" label

/**
 * Builds the model for the collapsed plan row: title, phase count and the first
 * `PLAN_SUMMARY_MAX_PHASES` phases. Never throws — `readPlan` absorbs parse failures
 * and exceptions — and never renders markdown: unparsable content becomes the
 * plain-text `getHandoffPreviewText` fallback.
 */
export function getPlanSummary(content: string): PlanSummary {
  const plan = readPlan(content);
  if (plan) {
    const phases = plan.phases
      .slice(0, PLAN_SUMMARY_MAX_PHASES)
      .map(({ id, title }) => ({ id, title }));
    return {
      kind: 'structured',
      title: plan.title,
      phaseCount: plan.phases.length,
      phases,
      hiddenPhaseCount: plan.phases.length - phases.length,
    };
  }
  return { kind: 'fallback', text: getHandoffPreviewText(content) };
}
