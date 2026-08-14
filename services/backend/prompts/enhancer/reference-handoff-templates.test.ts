import { describe, expect, it } from 'vitest';

import {
  renderEnhancerOutputTemplateContent,
  renderEnhancerReferencesXml,
} from './reference-handoff-templates';
import { getEnhancerToPlannerHandoffTemplate } from '../teams/duo/handoff-templates/enhancer-to-planner.js';

const FIXTURE_CHATROOM_ID = '000000000000010002chatroom_rooms';
const FIXTURE_CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

describe('renderEnhancerOutputTemplateContent', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('contains planner output section and intro', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).toContain('Enhancer output template');
    expect(result).toContain('<references>');
  });

  it('does NOT contain builder or user reference template bodies', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).not.toContain('### Handoff to `builder`');
    expect(result).not.toContain('### Handoff to `user`');
    expect(result).not.toContain('Delegation Brief');
    expect(result).not.toContain('Report Template');
  });
});

describe('materialized enhancer handoff-templates block (spawn output contract)', () => {
  const outputTemplate = getEnhancerToPlannerHandoffTemplate();

  it('matches inline snapshot — full content enhancer sees in task envelope handoff-templates', () => {
    const result = renderEnhancerOutputTemplateContent({
      teamId: 'duo',
      chatroomId: FIXTURE_CHATROOM_ID,
      outputTemplate,
      cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
      nativeIntegration: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Use these structures for this review. Your feedback must follow **Handoff to \`planner\`** (your output). Use \`<references>\` handoff templates to assess whether the planner builder draft aligns with final user delivery principles.

      ### Handoff to \`planner\` (your output)
      ---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`planner\` agent **only** receives the text inside your \`handoff --next-role="planner"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Planning Feedback (Enhancer → Planner)** — complete every section below. Do not omit sections, principles, or XML wrappers:

      When a section has no content, write exactly \`Not Applicable.\` — no explanation, no em-dash, no additional text.

      The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, align with user intent. Be **specific and targeted**: cite concrete claims, files, UX choices, and gaps from the check-in so the planner can improve the plan without re-synthesizing vague feedback.

      Give **concrete, actionable recommendations** in every section. End with **Recommendations** (second-last: summarized suggestions, tradeoffs, and considerations) then **Suggested edits** (last: proposed edits to grounding and the builder-handoff with file paths and code snippets). For UI work, complete the optional **UX** section using the reference below. For large or multi-surface revision work, complete the optional **Defragmentation** section using its reference below. **Do not rewrite their full builder brief.** The planner makes the final call.

      ### UX review checklist
      Complete the optional **UX** section in your output when the planner proposes UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Suggested edits** only.

      1. **Flows** — is the primary path straightforward? simpler alternatives exist?
      2. **Patterns** — consistent with existing project components and conventions? recommend one when multiple exist.
      3. **Layout** — unnecessary complexity, wrappers, or layout-shift risk?
      4. **Shortcuts** — aligned with the project keyboard/shortcut conventions? gaps or conflicts?
      5. **States** — loading, error, and empty states covered for async surfaces?
      6. **Error boundaries** — failures scoped so one subtree does not crash the whole app?
      7. **Feedback** — timely response for async user actions?
      8. **Destructive actions** — irreversible or high-impact single actions gated by confirmation?
      9. **Bulk actions** — batch/multi-item operations confirmed with scope or impact summary?

      ### Review principles
      - Ground feedback in the planner check-in and the project codebase — cite existing patterns rather than inventing generic UI preferences.
      - Do **not** prescribe style choices the project has not adopted (e.g. \`cursor: pointer\`, specific flex layouts, canonical card chrome, responsive utility patterns, button label copy).
      - Flag missing states and missing safeguards when the plan omits them; recommend consistency with established project conventions.
      - When multiple valid patterns exist in the codebase, recommend one and explain the tradeoff.

      ### Defragmentation workflow checklist
      Complete the optional **Defragmentation** section when the planner check-in addresses a large or multi-surface system revision, including refactoring, consolidation, or consistency work. Write exactly "Not Applicable." only when no such revision is proposed.

      1. **Study surfaces** — map all call sites, use cases, and complexity variants before proposing slices; name every relevant file/module
      2. **Golden implementation** — build a standalone canonical solution first; introduce canonical domain entities/types only when the studied variants require them, then shared use cases, UI components, or utilities; do not patch duplicates in place
      3. **Migrate callers** — refactor all consumers to the golden path; each slice must be shippable end-to-end
      4. **Delete legacy** — remove old implementations only after migration is complete; no dead-code leftovers

      ### Anti-patterns to flag
      - Incremental copy-paste fixes across N files without a golden SSOT
      - New abstraction without studying all existing variants
      - Leaving old code "for safety" after migration
      - Slices that add helpers/infra without a runnable end-to-end outcome
      - Parallel implementations coexisting without a deletion plan

      ### Structural decisions
      - Identify SSOT locations for domain entities, shared use cases, and UI components
      - Align with \`structural-decisions\` glossary: folder structure, file naming, interface locations
      - Flag when the plan scatters the canonical implementation across unrelated modules

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <overall assessment — cite specific strengths, risks, and whether the approach is sound; reference concrete elements from the check-in>

      ## User intent alignment
      <specific misreadings or missing constraints — what the user asked vs what the planner proposed>
      </handoff-overview>

      <!-- UI collapses proofs, direction, ux, defragmentation, and notes by default; overview and action required are expanded -->

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
      - **Flows:** <click count, nested modals, simpler alternatives>
      - **Patterns:** <consistency with existing project components; recommend one when multiple>
      - **Layout:** <complexity, wrappers, layout-shift risk>
      - **Shortcuts:** <alignment with catalog; gaps or conflicts>
      - **States:** <loading/error/empty coverage for async surfaces>
      - **Error boundaries:** <error boundary placement; failure isolated from the whole app>
      - **Feedback:** <timely response for async actions>
      - **Destructive safeguards:** <confirmation before irreversible/high-impact actions>
      - **Bulk safeguards:** <confirmation with scope summary for batch operations>
      </handoff-ux>

      <handoff-defragmentation>
      <!-- Optional — write exactly "Not Applicable." when no large or multi-surface system revision is proposed -->
      <!-- When revision work is proposed: specific findings tied to the planner's proposal. No code blocks (use Suggested edits). -->
      - **Surfaces:** <call sites and modules identified; gaps in surface mapping>
      - **Golden path:** <whether planner builds standalone canonical implementation first>
      - **Domain model:** <canonical types/entities needed or "not needed">
      - **Shared components:** <shared abstractions planned (use cases, UI, utilities)>
      - **Slice ordering:** <study → golden → migrate → delete sequence respected?>
      - **Migration plan:** <how all callers move to golden path>
      - **Deletion plan:** <old implementations slated for removal>
      - **Duplication:** <existing duplicates to eliminate; risk of new duplication>
      - **Structural decisions:** <folder/module boundaries; SSOT locations>
      </handoff-defragmentation>

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
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->

      ### <section or claim to remove or change>
      **File:** \`apps/webapp/src/path/to/file.ts\`
      **Change:** <what to remove, replace, or correct and why>

      \`\`\`typescript
      // Code snippet: what should change, be removed, or what the planner got wrong
      \`\`\`

      (Add one ### block per distinct removal or change. Use repo-relative paths with file extensions.)
      </handoff-action>
      \`\`\`

      Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.
      "
    `);
  });
});

describe('renderEnhancerReferencesXml', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('duo returns planner-to-builder and planner-to-user references', () => {
    const result = renderEnhancerReferencesXml(baseParams);

    expect(result).toContain('handoff-template for="planner->builder" team="duo"');
    expect(result).toContain('handoff-template for="planner->user" team="duo"');
    expect(result).toContain('Delegation Brief (Planner → Builder)');
    expect(result).toContain('Report Template (Planner → User)');
  });

  it('solo returns only solo-to-user reference', () => {
    const result = renderEnhancerReferencesXml({
      ...baseParams,
      teamId: 'solo',
    });

    expect(result).toContain('handoff-template for="solo->user" team="solo"');
    expect(result).not.toContain('planner->builder');
    expect(result).toContain('Report Template (Solo → User)');
  });
});
