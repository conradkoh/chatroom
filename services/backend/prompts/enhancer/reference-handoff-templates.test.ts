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

      1. **Flows** — primary action ≤3 clicks? simpler path exists?
      2. **Patterns** — matches existing components? recommend one if multiple. mobile vs desktop (responsive variants vs separate mobile UI)?
      3. **Layout** — compact title+menu row, description, trailing end-aligned CTA? unnecessary wrappers?
      4. **Shortcuts** — consistent with project conventions? gaps or conflicts?
      5. **States** — loading spinners/skeletons for async data? error messages on failure? empty states?
      6. **Error boundaries** — risky subtrees wrapped so a throw does not crash the whole app? failure isolated from the shell?
      7. **Alignment** — traced parent layout before leaf styles? position/height match siblings?
      8. **Feedback** — immediate pending state on async actions (e.g. save → button "Saving...")?
      9. **Destructive actions** — confirmation dialog before delete/remove/archive/reset/clear or other irreversible/high-impact single actions?
      10. **Bulk actions** — confirmation before batch/multi-item operations (with count or impact summary)?

      ### Flow complexity
      - Primary action ≤3 clicks from entry point
      - Extend existing surfaces (palette, settings tab, row action) before new navigation
      - Avoid nested modal chains and unjustified multi-step wizards
      - Prefer inline actions over navigate-away-and-back

      ### Presentation & responsive patterns
      - Reuse existing design-system components and established UI patterns before introducing new abstractions
      - Match badge/button styling from similar surfaces in the app
      - When multiple valid patterns exist, recommend one and explain tradeoff
      - Use the project's standard breakpoint(s) for mobile vs desktop
      - **Hide/show:** responsive utility classes or equivalent for alternate chrome per viewport
      - **Mobile overlay:** full-screen or sheet overlay with backdrop when desktop uses persistent panels
      - **Separate mobile UI:** dedicated mobile modal/picker when desktop uses side panel or split view
      - **Shared responsive density:** same component with size/density variants per breakpoint
      - **Command/search dialogs:** match existing modal/dialog styling; sensible max-width on small screens

      ### Layout simplification
      - Review card/section layouts for unnecessary rows, nested wrappers, or misaligned actions
      - Prefer compact rows: title and overflow menu on one line via flex/grid
      - Description on the next line; primary CTA on a trailing row aligned end
      - Canonical simplified card pattern:
        \`\`\`
        <title>          <overflow-menu>
        <description>
                         <primary-cta aligned end>
        \`\`\`
      - Use header + action grid or equivalent flex \`justify-between\`
      - Flag multi-row chrome that could collapse (menu on its own row, CTA misaligned vs similar cards)

      ### Error & loading states
      - Initial fetch: centered loader or skeleton for the content area
      - Pagination/infinite scroll: inline loader at scroll edge
      - Save/submit mutations: inline success/error feedback beside the trigger control
      - Never leave blank panels on fetch failure — show error message or retry affordance
      - Disable interactive controls while loading or pending

      ### Error boundaries
      - Wrap data-dependent or third-party subtrees with error boundaries so a single failure does not unmount the whole app
      - Scope boundaries to the failing panel/section, not the entire shell
      - Provide fallback UI with a recovery action (retry, reload, or navigate away)

      ### Alignment & component hierarchy
      - Before styling a leaf component, trace parent flex/grid context
      - Match sibling heights and vertical rhythm
      - Flag absolute positioning or fixed heights that fight parent layout
      - When hierarchy is unclear, inspect the rendered component tree (e.g. DOM inspector or component test snapshot) before deciding leaf styles

      ### Fast user feedback
      - Async actions triggered by keyboard shortcut or click must show **immediate** UI response
      - Canonical pattern: pending local state → button label changes (e.g. "Saving..."), control disabled while in flight
      - Show inline error on failure; brief success confirmation optional
      - Pair shortcut hints with pending state only when the action shows pending feedback

      ### Destructive & bulk action safeguards
      - **Destructive actions** (delete, remove, archive, reset, clear, disable) require an explicit confirmation step — never fire immediately from a menu item or button without a dialog
      - Use the project's standard confirmation dialog/modal pattern
      - Confirmation includes clear title + description of what will happen; primary action styled as destructive when appropriate
      - **Bulk actions** (multi-select delete, batch disable, clear-all) require confirmation before execution — show how many items are affected
      - Bulk confirm should summarize scope (e.g. "Delete 12 items?") and list material impact when non-obvious
      - Flag plans that wire bulk/destructive handlers directly to mutations/API calls without a confirm gate

      ### Keyboard shortcuts
      - Align proposed shortcuts with the project's existing shortcut catalog and platform conventions (⌘ on macOS, Ctrl on Windows/Linux)
      - Avoid conflicting bindings; document new shortcuts when introducing them
      - Common patterns: modifier+letter for global commands, Enter to confirm in dialogs, Escape to cancel/close, Shift+Enter for multiline input where applicable
      - Flag plans that add shortcuts without checking for conflicts or omit keyboard access for primary actions

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
