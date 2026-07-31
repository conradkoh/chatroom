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

      Give **concrete, actionable recommendations** in every section. End with **Recommendations** (second-last: summarized suggestions, tradeoffs, and considerations) then **Suggested edits** (last: proposed edits to grounding and the builder-handoff with file paths and code snippets). For UI work, complete the optional **UX** section using the reference below. **Do not rewrite their full builder brief.** The planner makes the final call.

      ### UX review checklist
      Complete the optional **UX** section in your output when the planner proposes UI changes. Write exactly "Not Applicable." for non-UI tasks. Put code snippets in **Suggested edits** only.

      1. **Flows** — primary action ≤3 clicks? simpler path exists?
      2. **Patterns** — matches existing components? recommend one if multiple. mobile vs desktop (md: variants vs separate mobile UI)?
      3. **Layout** — compact title+menu row, description, trailing end-aligned CTA? unnecessary wrappers?
      4. **Shortcuts** — consistent with catalog below? gaps or conflicts?

      ### Flow complexity
      - Primary action ≤3 clicks from entry point
      - Extend existing surfaces (palette, settings tab, row action) before new navigation
      - Avoid nested modal chains and unjustified multi-step wizards
      - Prefer inline actions over navigate-away-and-back

      ### Presentation & responsive patterns
      - Reuse existing components: \`CommandPalette\`, industrial dialogs, \`ChatroomLoader\`, timeline row chrome
      - Match badge/button patterns from timeline (\`BADGE_BASE\`, \`navButtonClass\` in All-tab)
      - When multiple valid patterns exist, recommend one and explain tradeoff
      - **md: breakpoint** (768px) splits mobile vs desktop
      - **Hide/show:** \`hidden md:flex\` / \`flex md:hidden\` for alternate chrome
      - **Mobile overlay:** fixed sidebar overlay with backdrop (\`md:hidden\`)
      - **Separate mobile UI:** dedicated mobile modal/picker when desktop uses side panel
      - **Shared responsive density:** same component, \`md:\` size variants (\`h-7 md:h-9\`)
      - **Command dialogs:** industrial theme via \`commandDialogStyles.ts\`, top-anchored, max-w-[90vw]

      ### Layout simplification
      - Review card/section layouts for unnecessary rows, nested wrappers, or misaligned actions
      - Prefer compact rows: title and overflow menu (⋮ \`MoreVertical\` popover) on one line via flex/grid
      - Description on the next line; primary CTA (e.g. "View Details") on a trailing row aligned end
      - Canonical simplified card pattern:
        \`\`\`
        <title>          <overflow-menu ⋮>
        <description>
                         <primary-cta aligned end>
        \`\`\`
      - Reuse \`CardHeader\` + \`CardAction\` grid (\`grid-cols-[1fr_auto]\`) or equivalent flex \`justify-between\`
      - Flag multi-row chrome that could collapse (menu on its own row, CTA left-aligned when end-aligned matches existing cards)

      ### Keyboard shortcuts (reference)
      | Shortcut | Action |
      |----------|--------|
      | ⌘K / Ctrl+K | Chatroom switcher |
      | ⌘P / Ctrl+P | File selector |
      | ⌘⇧P / Ctrl+Shift+P | Command palette (scripts, saved commands) |
      | ⌘⇧F / Ctrl+Shift+F | Workspace search |
      | ⌘I / Ctrl+I | Attach explorer snippet |
      | Enter (desktop, no Shift) | Send message |
      | Shift+Enter | New line in composer |
      | ⌘Enter / Ctrl+Enter | Confirm/save in modals |
      | ⌘S / Ctrl+S | Save in workspace file dialogs |
      | Escape | Close modal/dialog |

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <overall assessment — cite specific strengths, risks, and whether the approach is sound; reference concrete elements from the check-in>

      ## User intent alignment
      <specific misreadings or missing constraints — what the user asked vs what the planner proposed>
      </handoff-overview>

      <!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

      <handoff-proofs>
      ## Reasoning review
      <specific logical errors, weak inference, or contradictions — cite the claim and why it fails>
      </handoff-proofs>

      <handoff-direction>
      ## Alignment with eventual user handoff
      <specific gaps for user-facing completeness — what proof or report sections would be missing>

      ## UX
      <!-- Optional — write exactly "Not Applicable." when no UI changes are proposed -->
      <!-- When UI is proposed: specific findings tied to the planner's proposal. No code blocks (use Suggested edits). -->
      - **Flows:** <specific finding — click count, nested modals, simpler alternatives>
      - **Patterns:** <which existing pattern fits; recommend one if multiple; mobile vs desktop>
      - **Layout:** <compact rows, trailing CTAs, unnecessary wrappers>
      - **Shortcuts:** <alignment with catalog; gaps or conflicts>
      </handoff-direction>

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
