/**
 * XML-wrapped independent planning input for enhancer → planner handoffs.
 * Maps the enhancer's findings into the same collapsible UI tags used by
 * planner reports. Implementation notes remain last so code is generated only
 * after the analysis that justifies it.
 */
import { getFileReferenceGuidanceComment } from './file-reference-guidance';

export function getEnhancerFeedbackTemplateBody(): string {
  return `<handoff-overview>
## Summary
<concise independent assessment of the request, the likely solution shape, and the most important finding>

## User intent and constraints
<what the user is trying to achieve, explicit requirements, relevant prior-message context, and constraints that must be preserved>
</handoff-overview>

<!-- UI collapses proofs, direction, ux, defragmentation, and notes by default; overview and action required are expanded -->

<handoff-proofs>
## Codebase grounding
<relevant files, current behavior, established patterns, data flow, tests, and concrete evidence discovered in the repository>

## Evidence
<file paths and short snippets the enhancer verified in the repository — cite concretely>
</handoff-proofs>

<handoff-direction>
## Proposed approaches
<!-- Provide 2–3 options with tradeoffs. Preserve planner decision authority — do not collapse to a single recommendation. -->

### Option A: <short name>
<tradeoffs, fit, risks>

### Option B: <short name>
<tradeoffs, fit, risks>

### Option C: <short name> (optional — omit if only two viable options)
<tradeoffs, fit, risks>
</handoff-direction>

<handoff-ux>
<!-- Optional — write exactly "Not Applicable." when the user request does not involve UI changes -->
<!-- When UI is involved: ground each finding in user history and repository patterns. Put code only in Implementation notes. -->
- **Flows:** <click count, nested modals, simpler alternatives>
- **Patterns:** <consistency with existing project components; recommend one when multiple>
- **Layout:** <complexity, wrappers, layout stable across state transitions — no layout shift>
- **Shortcuts:** <alignment with catalog; gaps or conflicts>
- **States:** <loading/error/empty explicitly handled; no blank panels or silent failures>
- **Error boundaries:** <error boundary placement; failure isolated from the whole app>
- **Feedback:** <timely response for async actions>
- **Interaction affordance:** <pointer cursor or project equivalent on clickable elements where applicable>
- **Destructive safeguards:** <confirmation before irreversible/high-impact actions>
- **Bulk safeguards:** <confirmation with scope summary for batch operations>
</handoff-ux>

<handoff-defragmentation>
<!-- Optional — write exactly "Not Applicable." when the request does not involve a large or multi-surface revision -->
<!-- When revision work is involved: map the existing surfaces independently. Put code only in Implementation notes. -->
- **Surfaces:** <call sites and modules identified; gaps in surface mapping>
- **Golden path:** <standalone canonical implementation to establish first>
- **Domain model:** <canonical types/entities needed or "not needed">
- **Shared components:** <shared abstractions needed across use cases, UI, or utilities>
- **Slice ordering:** <study → golden path → migrate → delete sequence>
- **Migration plan:** <how all callers move to the golden path>
- **Deletion plan:** <old implementations to remove after migration>
- **Duplication:** <existing duplicates to eliminate and risk of introducing new duplication>
- **Structural decisions:** <folder/module boundaries and SSOT locations>
</handoff-defragmentation>

<handoff-notes>
## Open questions for user
<decisions only the user can make; state what choice is needed, or write "Not Applicable.">
</handoff-notes>

<handoff-action>
## Risks and mitigations
<specific failure modes or tradeoffs, their impact, and a practical mitigation for each>

## Recommended next steps
<!-- SECOND-LAST — ordered, concrete work the planner should consider when producing the final plan. No code blocks here. -->

## Implementation notes
<!-- LAST — use only when file-level details or short code examples materially clarify the recommendation. -->
${getFileReferenceGuidanceComment()}

### <implementation detail>
**File:** \`apps/webapp/src/path/to/file.ts\`
**Note:** <what the planner should know and why>

\`\`\`typescript
// Short illustrative snippet, only when useful
\`\`\`

(Add one ### block per distinct detail. Write "Not Applicable." when none are needed.)
</handoff-action>`;
}
