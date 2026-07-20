/**
 * Unit tests for role-specific handoff templates.
 *
 * Full inline snapshots (with delivery-time CLI params) let PR reviewers audit
 * every line of each template — including HTML comment hints — without opening
 * integration tests. Structural invariants (no optional fields, resolver dispatch)
 * are asserted separately.
 */

import { describe, expect, test } from 'vitest';

import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { getBuilderToPlannerHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-builder';
import { getPlannerToUserReportTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-user';
import { getSoloToUserReportTemplate } from '../../../prompts/teams/solo/handoff-templates/solo-to-user';
import {
  handoffTemplateDeliveryParams,
  resolveDeliveredHandoffTemplate,
} from '../../helpers/handoff-template-fixtures';

describe('handoff-templates > resolver', () => {
  test('resolves planner → builder to the delegation brief', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'builder' })).toBe(
      getPlannerToBuilderHandoffTemplate()
    );
  });

  test('resolves planner → user to the report template', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'user' })).toBe(
      getPlannerToUserReportTemplate()
    );
  });

  test('resolves builder → planner to the work-complete template', () => {
    expect(getHandoffTemplate({ fromRole: 'builder', toRole: 'planner' })).toBe(
      getBuilderToPlannerHandoffTemplate()
    );
  });

  test('is case-insensitive on role names', () => {
    expect(getHandoffTemplate({ fromRole: 'Planner', toRole: 'USER' })).toBe(
      getPlannerToUserReportTemplate()
    );
  });

  test('returns null for role pairs without a specialized template', () => {
    expect(getHandoffTemplate({ fromRole: 'builder', toRole: 'user' })).toBeNull();
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'reviewer' })).toBeNull();
  });

  test('resolves solo → user to the solo report template', () => {
    const params = handoffTemplateDeliveryParams('solo');
    expect(
      getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'user', ...params })
    ).toBe(getSoloToUserReportTemplate(params));
  });

  test('delivery params match direct getter calls for duo planner → user', () => {
    const params = handoffTemplateDeliveryParams('planner');
    expect(
      getHandoffTemplate({ teamId: 'duo', fromRole: 'planner', toRole: 'user', ...params })
    ).toBe(getPlannerToUserReportTemplate(params));
  });

  test('delivery params match direct getter calls for duo builder → planner', () => {
    const params = handoffTemplateDeliveryParams('builder');
    expect(
      getHandoffTemplate({ teamId: 'duo', fromRole: 'builder', toRole: 'planner', ...params })
    ).toBe(getBuilderToPlannerHandoffTemplate(params));
  });
});

describe('handoff-templates > full template snapshots (delivery params)', () => {
  test('duo planner → user', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
      role: 'planner',
    });
    expect(template).toMatchInlineSnapshot(`
      "---

      ⚠️ **CRITICAL — Recipient visibility**

      The user **only** receives the text inside your \`handoff --next-role="user"\` command.

      They **cannot** see:
      - Anything you write in this agent session (including direct replies like "Hello!")
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Report Template (Planner → User)** — fill in EVERY section below in your handoff message. If a section does not apply, write \`Not Applicable\` (do not delete the section):

      \`\`\`markdown
      ## Summary
      <what was accomplished, in plain terms — no references to prior messages>

      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="planner"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Planning
      <!-- Demonstrate the goal was decomposed into actionable steps with clear outcomes before implementation. -->
      - <step 1: concrete artifact or outcome>
      - <step 2: concrete artifact or outcome>
      <List the planned slices/steps the planner defined (or would have defined) before delegating. Each step should name a verifiable deliverable — not vague layers like "backend work". Write \`Not Applicable\` only for trivial single-step tasks.>

      ## What changed
      <high-level view of what changed since the user's message before the detailed proofs below>

      ### Proof of Principles
      <!-- Demonstrate adherence to:
      - Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms.
      - Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
      - Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently.
      - Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
      - No Revisit: implemented in a way so the user does not have to revisit this implementation again.
      - Leave It Better: leave the code in a slightly better state than before when touching files.
      -->
      <how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

      ### Proof of Completion
      - [ ] I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met
      <!-- Read context before handoff if not already done this task: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="planner"\`. State the context goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you (or the builder) modified>

      ## Backlog Tasks Implemented
      - \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>
      <List every backlog item this work implemented. Write \`Not Applicable\` if no backlog items were in scope.>

      ## Backlog Pending User Review Confirmation
      - [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` because a PR has been raised for user review
      - PR URL(s): <link to PR(s), or \`Not Applicable\` if no PR was raised>
      - If no backlog items apply, write \`Not Applicable\` for the checkbox and explain in one line

      ## Key Technical Decisions
      - <schema design, modules, interfaces, domain entities — what you chose and why, or "Not Applicable">

      ## Key Tradeoffs
      - <what was weighed against what, and why you chose this path, or "Not Applicable">

      ## Tech Debt Observed
      - <issues noticed but intentionally left out of scope of this change, or "Not Applicable">

      ## System Design
      <include a mermaid diagram when the change has non-trivial structure; write "Not Applicable" for trivial changes>

      \`\`\`mermaid
      flowchart TD
          A[Component] --> B[Component]
      \`\`\`

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)

      ## Unresolved Decisions
      <!-- Decisions that need user input before work can proceed. -->
      - <decision or question — options considered, recommendation if any, or "Not Applicable">
      <Carry forward decisions still open from earlier handoffs in this chatroom. Remove items the user has resolved. Do not decide on the user's behalf unless they explicitly asked you to. Write \`Not Applicable\` only when there are truly no open decisions.>

      ## Notes / Next steps
      <anything the user should know, follow-ups, or open questions, or "Not Applicable">
      \`\`\`"
    `);
  });

  test('duo builder → planner', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'builder',
      toRole: 'planner',
      role: 'builder',
    });
    expect(template).toMatchInlineSnapshot(`
      "---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`planner\` agent **only** receives the text inside your \`handoff --next-role="planner"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Handoff Template (Builder → Planner)** — paste into the handoff message. Fill in EVERY section below. If a section does not apply, write \`Not Applicable\` (do not delete the section):

      \`\`\`markdown
      ## Summary
      <what was implemented or attempted, in plain terms>

      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Principles
      <!-- Demonstrate adherence to:
      - Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms.
      - Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
      - Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently.
      - Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
      - No Revisit: implemented in a way so the user does not have to revisit this implementation again.
      - Leave It Better: leave the code in a slightly better state than before when touching files.
      -->
      <how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

      ## Proof of Completion
      - [ ] I confirm that the goal and acceptance criteria from the planner’s delegation brief have been met
      <!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you modified>

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)

      ## Blockers / questions
      <anything needing planner decision, or "Not Applicable">

      ## Notes for review
      <specific areas for planner to check, or "Not Applicable">
      \`\`\`"
    `);
  });

  test('duo planner → builder (CLI)', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'builder',
      role: 'planner',
      nativeIntegration: false,
    });
    expect(template).toMatchInlineSnapshot(`
      "---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`builder\` agent **only** receives the text inside your \`handoff --next-role="builder"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

      **Division of labor:** You (planner) own architecture and API shape. The builder implements exactly what you specify and does not redesign or invent alternatives unless blocked.

      **Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

      \`\`\`markdown
      ## Summary
      <brief context for this delegation slice — what problem it solves and where it fits in the larger task>

      ## Goal
      <one sentence: the outcome this slice delivers>

      ## Key Knowledge for High Quality Bar
      <details that would move the implementation from good to excellent and delightful — domain context, user expectations, edge cases, naming, UX polish, invariants the builder must preserve>

      ## Force Multipliers
      <choices that greatly simplify the solution while preserving long-term maintainability — reuse existing abstractions, avoid unnecessary layers, leverage platform conventions>

      ## Files to implement (exhaustive, file-level)
      List **every** file in this slice. For each file, state the exact change and paste the code the builder should match (no guessing).
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->

      ### \`apps/webapp/src/path/to/file.ts\`
      **Change:** <precisely what to add, modify, or remove in this file>

      \`\`\`typescript
      // Target code: exports, types, function bodies, component skeleton, query/mutation shape, etc.
      // Enough that the builder can implement this file without inventing structure
      \`\`\`

      ### \`apps/webapp/src/path/to/other-file.ts\`
      **Change:** <...>

      \`\`\`typescript
      // ...
      \`\`\`

      (Add one ### block per file. If this slice touches only one file, still use the ### header.)

      ## Shared contracts (planner-owned)
      Cross-file types, interfaces, or patterns that apply beyond a single file. Write \`Not Applicable\` if everything is already specified per-file above.

      ### Interfaces & types
      \`\`\`typescript
      // Shared signatures, schemas, props, or DB shapes
      \`\`\`

      ### Reference snippets
      \`\`\`typescript
      // Canonical call patterns, hook usage, imports, or wiring between files
      \`\`\`

      ## Requirements (acceptance criteria)
      - <verifiable outcome the builder can self-check>

      ## What to avoid
      - <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
      - <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs", or "Not Applicable">

      ## Skills to activate
      - <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder, or "Not Applicable">

      ## Out of scope
      - <files or areas the builder must NOT touch in this slice, or "Not Applicable">

      ## Session Augmentation
      Valid values: \`none\` | \`compact\` | \`new_session\`
      - \`none\` — continue prior session context
      - \`compact\` — run in-session context compaction (native SDK harnesses only)
      - \`new_session\` — start a completely new session (default)
      // data:agent.session_augmentation=new_session

      \`compact\` is NOT supported — use \`none\` or \`new_session\`. \`new_session\` requires a hard restart (daemon stops agent, cold-starts, agent rejoins via \`get-next-task\`). \`none\` resumes prior session (\`wantResume=true\`).

      Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once."
    `);
  });

  test('duo planner → builder (native)', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'builder',
      role: 'planner',
      nativeIntegration: true,
    });
    expect(template).toMatchInlineSnapshot(`
      "---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`builder\` agent **only** receives the text inside your \`handoff --next-role="builder"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

      **Division of labor:** You (planner) own architecture and API shape. The builder implements exactly what you specify and does not redesign or invent alternatives unless blocked.

      **Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

      \`\`\`markdown
      ## Summary
      <brief context for this delegation slice — what problem it solves and where it fits in the larger task>

      ## Goal
      <one sentence: the outcome this slice delivers>

      ## Key Knowledge for High Quality Bar
      <details that would move the implementation from good to excellent and delightful — domain context, user expectations, edge cases, naming, UX polish, invariants the builder must preserve>

      ## Force Multipliers
      <choices that greatly simplify the solution while preserving long-term maintainability — reuse existing abstractions, avoid unnecessary layers, leverage platform conventions>

      ## Files to implement (exhaustive, file-level)
      List **every** file in this slice. For each file, state the exact change and paste the code the builder should match (no guessing).
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->

      ### \`apps/webapp/src/path/to/file.ts\`
      **Change:** <precisely what to add, modify, or remove in this file>

      \`\`\`typescript
      // Target code: exports, types, function bodies, component skeleton, query/mutation shape, etc.
      // Enough that the builder can implement this file without inventing structure
      \`\`\`

      ### \`apps/webapp/src/path/to/other-file.ts\`
      **Change:** <...>

      \`\`\`typescript
      // ...
      \`\`\`

      (Add one ### block per file. If this slice touches only one file, still use the ### header.)

      ## Shared contracts (planner-owned)
      Cross-file types, interfaces, or patterns that apply beyond a single file. Write \`Not Applicable\` if everything is already specified per-file above.

      ### Interfaces & types
      \`\`\`typescript
      // Shared signatures, schemas, props, or DB shapes
      \`\`\`

      ### Reference snippets
      \`\`\`typescript
      // Canonical call patterns, hook usage, imports, or wiring between files
      \`\`\`

      ## Requirements (acceptance criteria)
      - <verifiable outcome the builder can self-check>

      ## What to avoid
      - <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
      - <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs", or "Not Applicable">

      ## Skills to activate
      - <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder, or "Not Applicable">

      ## Out of scope
      - <files or areas the builder must NOT touch in this slice, or "Not Applicable">

      ## Session Augmentation
      Valid values: \`none\` | \`compact\` | \`new_session\`
      - \`none\` — continue prior session context
      - \`compact\` — run in-session context compaction (native SDK harnesses only)
      - \`new_session\` — start a completely new session (default)
      // data:agent.session_augmentation=new_session

      \`compact\` runs in-session context compaction via the SDK runtime. \`new_session\` starts a completely new session within the same process (not compaction). \`none\` continues the prior session. Tasks continue via injection.

      Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once."
    `);
  });

  test('solo → user', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'solo',
      fromRole: 'solo',
      toRole: 'user',
      role: 'solo',
    });
    expect(template).toMatchInlineSnapshot(`
      "---

      ⚠️ **CRITICAL — Recipient visibility**

      The user **only** receives the text inside your \`handoff --next-role="user"\` command.

      They **cannot** see:
      - Anything you write in this agent session (including direct replies like "Hello!")
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Report Template (Solo → User)** — fill in EVERY section below in your handoff message. If a section does not apply, write \`Not Applicable\` (do not delete the section):

      \`\`\`markdown
      ## Summary
      <what was accomplished, in plain terms — no references to prior messages>

      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of any planning, before implementing any code for this task
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="solo"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Planning
      <!-- Demonstrate the goal was decomposed into actionable steps with clear outcomes before implementation. -->
      - <step 1: concrete artifact or outcome>
      - <step 2: concrete artifact or outcome>
      <List the planned steps you defined before implementing. Each step should name a verifiable deliverable — not vague layers like "backend work". Write \`Not Applicable\` only for trivial single-step tasks.>

      ## What changed
      <high-level view of what changed since the user's message before the detailed proofs below>

      ### Proof of Principles
      <!-- Demonstrate adherence to:
      - Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms.
      - Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
      - Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently.
      - Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
      - No Revisit: implemented in a way so the user does not have to revisit this implementation again.
      - Leave It Better: leave the code in a slightly better state than before when touching files.
      -->
      <how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

      ### Proof of Completion
      - [ ] I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met
      <!-- Read context before handoff if not already done this task: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="solo"\`. State the context goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you modified>

      ## Backlog Tasks Implemented
      - \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>
      <List every backlog item this work implemented. Write \`Not Applicable\` if no backlog items were in scope.>

      ## Backlog Pending User Review Confirmation
      - [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` because a PR has been raised for user review
      - PR URL(s): <link to PR(s), or \`Not Applicable\` if no PR was raised>
      - If no backlog items apply, write \`Not Applicable\` for the checkbox and explain in one line

      ## Key Technical Decisions
      - <schema design, modules, interfaces, domain entities — what you chose and why, or "Not Applicable">

      ## Key Tradeoffs
      - <what was weighed against what, and why you chose this path, or "Not Applicable">

      ## Tech Debt Observed
      - <issues noticed but intentionally left out of scope of this change, or "Not Applicable">

      ## System Design
      <include a mermaid diagram when the change has non-trivial structure; write "Not Applicable" for trivial changes>

      \`\`\`mermaid
      flowchart TD
          A[Component] --> B[Component]
      \`\`\`

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)

      ## Unresolved Decisions
      <!-- Decisions that need user input before work can proceed. -->
      - <decision or question — options considered, recommendation if any, or "Not Applicable">
      <Carry forward decisions still open from earlier handoffs in this chatroom. Remove items the user has resolved. Do not decide on the user's behalf unless they explicitly asked you to. Write \`Not Applicable\` only when there are truly no open decisions.>

      ## Notes / Next steps
      <anything the user should know, follow-ups, or open questions, or "Not Applicable">
      \`\`\`"
    `);
  });
});

describe('handoff-templates > invariants', () => {
  const deliveredTemplates: [string, string | null][] = [
    [
      'duo planner → user',
      resolveDeliveredHandoffTemplate({
        teamId: 'duo',
        fromRole: 'planner',
        toRole: 'user',
        role: 'planner',
      }),
    ],
    [
      'duo builder → planner',
      resolveDeliveredHandoffTemplate({
        teamId: 'duo',
        fromRole: 'builder',
        toRole: 'planner',
        role: 'builder',
      }),
    ],
    [
      'duo planner → builder (CLI)',
      resolveDeliveredHandoffTemplate({
        teamId: 'duo',
        fromRole: 'planner',
        toRole: 'builder',
        role: 'planner',
        nativeIntegration: false,
      }),
    ],
    [
      'solo → user',
      resolveDeliveredHandoffTemplate({
        teamId: 'solo',
        fromRole: 'solo',
        toRole: 'user',
        role: 'solo',
      }),
    ],
  ];

  for (const [label, template] of deliveredTemplates) {
    test(`${label} has no optional fields — instructs Not Applicable instead`, () => {
      expect(template).toBeTruthy();
      expect(template).toContain('Not Applicable');
      expect(template).not.toMatch(/—\s*optional/i);
    });

    test(`${label} is markdown (fenced code block)`, () => {
      expect(template).toContain('```markdown');
    });
  }

  test('builder → planner includes delegation-brief HTML comment for proof of completion', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'builder',
      toRole: 'planner',
      role: 'builder',
    });
    expect(template).toContain(
      '<!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->'
    );
    expect(template).toContain(
      'I confirm that the goal and acceptance criteria from the planner\u2019s delegation brief have been met'
    );
  });

  test('planner → user includes context-read HTML comment with resolved command', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
      role: 'planner',
    });
    expect(template).toContain(
      '<!-- Read context before handoff if not already done this task: `CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="planner"`. State the context goal and confirm it was achieved. -->'
    );
  });

  test('solo → user includes context-read HTML comment with resolved command', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'solo',
      fromRole: 'solo',
      toRole: 'user',
      role: 'solo',
    });
    expect(template).toContain(
      '<!-- Read context before handoff if not already done this task: `CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="solo"`. State the context goal and confirm it was achieved. -->'
    );
  });

  test('planner → user includes role-guidance HTML comment with resolved command', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
      role: 'planner',
    });
    expect(template).toContain(
      '<!-- Role guidance is static for your role and does not change between tasks. Run once if needed: `CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="planner"`. You do not need to re-read it on every task if you have already read it once. -->'
    );
  });

  test('user report templates include unresolved decisions carry-forward section', () => {
    for (const role of ['planner', 'solo'] as const) {
      const template = resolveDeliveredHandoffTemplate({
        teamId: role === 'solo' ? 'solo' : 'duo',
        fromRole: role,
        toRole: 'user',
        role,
      });
      expect(template).toContain('## Unresolved Decisions');
      expect(template).toContain('Carry forward decisions still open from earlier handoffs');
    }
  });
});
