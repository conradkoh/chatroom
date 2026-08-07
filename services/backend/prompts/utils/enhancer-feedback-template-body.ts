/**
 * XML-wrapped planning feedback body for enhancer → planner handoffs.
 * Maps 8 sections into 6 collapsible UI tags (same tags as
 * planner→user report handoffs plus handoff-ux). UX is its own optional
 * tag between direction and notes; Suggested edits is the last `##`
 * heading — code examples come last for LLM generation.
 */
import { getFileReferenceGuidanceComment } from './file-reference-guidance';

export function getEnhancerFeedbackTemplateBody(): string {
  return `<handoff-overview>
## Summary
<overall assessment — cite specific strengths, risks, and whether the approach is sound; reference concrete elements from the check-in>

## User intent alignment
<specific misreadings or missing constraints — what the user asked vs what the planner proposed>
</handoff-overview>

<!-- UI collapses proofs, direction, ux, and notes by default; overview and action required are expanded -->

<handoff-proofs>
## Reasoning review
<specific logical errors, weak inference, or contradictions — cite the claim and why it fails>
</handoff-proofs>

<handoff-direction>
## Alignment with eventual user handoff
<specific gaps for user-facing completeness — what proof or report sections would be missing>
</handoff-direction>

<handoff-ux>
<!-- Optional — write exactly "Not Applicable." when no UI changes are proposed -->
<!-- When UI is proposed: specific findings tied to the planner's proposal. No code blocks (use Suggested edits). -->
- **Flows:** <specific finding — click count, nested modals, simpler alternatives>
- **Patterns:** <which existing pattern fits; recommend one if multiple; mobile vs desktop>
- **Layout:** <compact rows, trailing CTAs, unnecessary wrappers>
- **Shortcuts:** <alignment with catalog; gaps or conflicts>
- **States:** <loading/error/empty coverage for async surfaces>
- **Error boundaries:** <error boundary placement; failure isolated from the whole app>
- **Alignment:** <hierarchy traced; position/height issues; inline snapshot consideration>
- **Feedback:** <immediate pending state on async actions; ⌘Enter + button state>
- **Destructive safeguards:** <single-item irreversible/high-impact actions gated by confirm dialog; cite missing confirms>
- **Bulk safeguards:** <batch/multi-item operations gated by confirm with count/impact summary; cite missing confirms>
</handoff-ux>

<handoff-notes>
## Knowledge gaps
<specific facts, files, or research to verify — name what to check and why>
</handoff-notes>

<handoff-action>
## Risks & failure modes
<specific risks tied to this plan — what fails, under what conditions, and how to mitigate>

## Recommendations
<!-- SECOND-LAST — concrete, actionable suggestions tied to the check-in. Include tradeoffs and considerations. No code blocks here (use Suggested edits for snippets). -->

## Suggested edits (remove or change only)
<!-- LAST — proposed edits to grounding and builder-handoff. File paths and code snippets required when recommending changes. Omit entirely if none. -->
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
