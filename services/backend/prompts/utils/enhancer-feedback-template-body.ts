/**
 * XML-wrapped planning feedback body for enhancer → planner handoffs.
 * Maps the 7 advisory sections into 5 collapsible UI categories
 * (same tags as planner→user report handoffs).
 */
export function getEnhancerFeedbackTemplateBody(): string {
  return `<handoff-overview>
## Summary
<one paragraph: overall assessment — strengths, main risks, and whether the approach is sound>

## User intent alignment
<does the planner's reading of the user request match what was asked? misreadings or missing constraints?>
</handoff-overview>

<!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

<handoff-proofs>
## Reasoning review
<logical errors, weak inference, contradictions — challenge assumptions>
</handoff-proofs>

<handoff-direction>
## Alignment with eventual user handoff
<will this approach produce a credible planner→user report? what's missing for user-facing completeness?>
</handoff-direction>

<handoff-notes>
## Knowledge gaps
<facts, context, or research the planner should verify — advisory questions, not answers from codebase>
</handoff-notes>

<handoff-action>
## Risks & failure modes
<what could go wrong if they proceed as planned? common pitfalls for this kind of work?>

## Questions for the planner
<specific questions they should answer before delegating — not instructions disguised as questions>
</handoff-action>`;
}
