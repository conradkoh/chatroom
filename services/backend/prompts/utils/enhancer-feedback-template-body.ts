/**
 * XML-wrapped design input for enhancer → planner handoffs.
 * Maps the enhancer's findings into the same collapsible UI tags used by
 * planner reports. Implementation sequencing remains last so code is generated
 * only after the design that justifies it.
 */
import { getDataQueryDesignTemplateBlock } from './data-query-design';
import {
  getFrontendDesignUxFlowChecklistBlock,
  getFrontendDesignUxPlanningPrinciplesBlock,
} from './frontend-design-ux-checklist';
import { getHandoffQualityPrinciplesSectionBlock } from './handoff-quality-principles';

export function getEnhancerFeedbackTemplateBody(): string {
  return `<handoff-overview>
## Summary
<one paragraph: what we're building and the single design direction>

## User intent and constraints
<explicit requirements from user messages; hard constraints that must not be violated>
</handoff-overview>

<!-- UI collapses proofs, direction, frontend design, data design, and notes by default; overview and action required are expanded -->

<handoff-proofs>
## Repository evidence
<files read, current behavior verified, patterns reused — cite repo-relative paths and short snippets only>

${getHandoffQualityPrinciplesSectionBlock('design')}
</handoff-proofs>

<handoff-direction>
## Recommended design
<!-- ONE design only. No Option A/B/C. -->

<2–4 sentences: the chosen architecture and why it fits the request and existing system>
</handoff-direction>

<handoff-frontend-design>
## Frontend / user-centric design

${getFrontendDesignUxPlanningPrinciplesBlock()}

### Flow 1: <name>
**Entry:** User visits \`<route/page>\` from \`<source>\`.

| Step | User action | System response | UI state |
|------|-------------|-----------------|----------|
| 1 | User clicks \`<element label>\` | \`<navigation / modal / fetch>\` | \`<loading → success/error>\` |

${getFrontendDesignUxFlowChecklistBlock()}

**Expected interactions per element:**
- \`<ElementName>\` (\`apps/webapp/src/...\`): click → \`<handler>\`; keyboard: \`<tab order>\`; disabled when \`<condition>\`

### Element, style, and layout specification

#### \`<ComponentName>\` — \`apps/webapp/src/path/to/Component.tsx\`
**Change:** <create | modify>

**Layout:** \`<div className="...">\` — flex/grid, gaps, breakpoints

**States:** loading | empty | error | success

\`\`\`tsx
export function ComponentName({ ... }: Props) {
  // target structure — props, classNames, branches
}
\`\`\`

<!-- Repeat per component; write exactly "Not Applicable." for the entire section if no UI -->
</handoff-frontend-design>

<handoff-data-design>
${getDataQueryDesignTemplateBlock()}
</handoff-data-design>

<handoff-notes>
## Open questions for user
<decisions only the user can make, or write "Not Applicable.">
</handoff-notes>

<handoff-action>
## Recommended implementation sequence
<!-- Ordered slices for the planner — references files from design sections. For large or multi-surface revisions, activate the defragmentation skill before delegating. -->

1. …
2. …

## Files touched (index)
- \`apps/webapp/src/...\` — …
- \`services/backend/convex/...\` — …
</handoff-action>`;
}
