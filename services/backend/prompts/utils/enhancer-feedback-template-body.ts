/**
 * XML-wrapped planning feedback body for enhancer → planner handoffs.
 * Maps the 7 advisory sections into 5 collapsible UI categories
 * (same tags as planner→user report handoffs). Suggested edits is the
 * last `##` heading — code examples come last for LLM generation.
 */
import { getFileReferenceGuidanceComment } from './file-reference-guidance';

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

## Recommendations
<!-- SECOND-LAST SECTION — abstract guidance only. No file paths, no code blocks. -->
<!-- For UI changes: report UX checklist findings (write "Not Applicable." for non-UI tasks): -->
- **Flows:** ...
- **Patterns:** ... (include mobile vs desktop)
- **Layout:** ...
- **Shortcuts:** ...
<!-- Include questions for the planner and other actionable recommendations here. -->

## Suggested edits (remove or change only)
<!-- LAST SECTION — file-level detail and code examples only. Omit entirely if none. -->
When you recommend removing or changing specific content in the planner's check-in, list each change here with file-level detail and code examples.
${getFileReferenceGuidanceComment()}

### <section or claim to remove or change>
**File:** \`apps/webapp/src/path/to/file.ts\`
**Change:** <what to remove, replace, or correct and why>

\`\`\`typescript
// Code snippet: what should change, be removed, or what the planner got wrong
\`\`\`

(Add one ### block per distinct removal or change. Use repo-relative paths with file extensions.)
</handoff-action>`;
}
