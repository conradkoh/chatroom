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
import { getEnhancerToPlannerHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/enhancer-to-planner';
import { getPlannerToBuilderHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-builder';
import { getPlannerToEnhancerHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-enhancer';
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

  test('resolves planner → enhancer to the mandatory check-in template', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'enhancer' })).toBe(
      getPlannerToEnhancerHandoffTemplate()
    );
  });

  test('resolves enhancer → planner to the planning feedback template', () => {
    expect(getHandoffTemplate({ fromRole: 'enhancer', toRole: 'planner' })).toBe(
      getEnhancerToPlannerHandoffTemplate()
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

      **Report Template (Planner → User)** — complete every section below. When a section or field does not apply, write \`Not Applicable\` — do not omit sections, principles, or XML wrappers:

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <what was accomplished, in plain terms — no references to prior messages>

      ## What changed
      <high-level view of what changed since the user's message>
      </handoff-overview>

      <!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

      <handoff-proofs>
      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="planner"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Planning
      <!-- REQUIRED. List planning steps, or write "Not Applicable" for trivial single-step tasks. Do not omit this section. -->
      - <step 1: concrete artifact or outcome>
      - <step 2: concrete artifact or outcome>

      ## Proof of Principles
      <!-- REQUIRED: Complete every principle below. Write an explanation or "Not Applicable" for each — do not omit this section or skip any principle bullet. -->
      - **Semantic Consistency:** <how this work demonstrates semantic consistency, or Not Applicable>
      <!-- Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms. -->

      - **Organization & Maintainability:** <how this work demonstrates organization & maintainability, or Not Applicable>
      <!-- Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders. -->

      - **Reducing Optionality:** <how this work demonstrates reducing optionality, or Not Applicable>
      <!-- Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently. -->

      - **Static Evaluability and Provability:** <how this work demonstrates static evaluability and provability, or Not Applicable>
      <!-- Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order. -->

      - **No Revisit:** <how this work demonstrates no revisit, or Not Applicable>
      <!-- No Revisit: implemented in a way so the user does not have to revisit this implementation again. -->

      - **Leave It Better:** <how this work demonstrates leave it better, or Not Applicable>
      <!-- Leave It Better: leave the code in a slightly better state than before when touching files. -->

      ## Proof of Completion
      - [ ] I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met
      <!-- Read context before handoff if not already done this task: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="planner"\`. State the context goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you (or the builder) modified>

      ## Backlog Tasks Implemented
      <!-- REQUIRED. List backlog items addressed, or write "Not Applicable" if none were in scope. Do not omit this section. -->
      - \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>

      ## Backlog Pending User Review Confirmation
      <!-- REQUIRED. Complete the attestation, or write "Not Applicable" if no backlog items apply. Do not omit this section. -->
      - [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` after the feature was verified end-to-end and a PR was raised for user review
      - PR URL(s): <link to PR(s)>

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)
      </handoff-proofs>

      <handoff-direction>
      ## What exists today
      <!-- REQUIRED. Describe current state after this work, or write "Not Applicable". Do not omit this section. -->
      <current state after this work — what the user can now do, what is in place, how the system behaves>

      ## Key Technical Decisions
      <!-- REQUIRED. List decisions, or write "Not Applicable". Do not omit this section. -->
      - <schema design, modules, interfaces, domain entities — what you chose and why>

      ## Key Tradeoffs
      <!-- REQUIRED. List tradeoffs, or write "Not Applicable". Do not omit this section. -->
      - <what was weighed against what, and why you chose this path>

      ## System Design
      <!-- REQUIRED. Include a mermaid diagram when the change has non-trivial structure, or write "Not Applicable". Do not omit this section. -->

      \`\`\`mermaid
      flowchart TD
          A[Component] --> B[Component]
      \`\`\`
      </handoff-direction>

      <handoff-notes>
      ## Notes
      <!-- REQUIRED. Write notes, or "Not Applicable" if none. Do not omit this section. -->
      <anything the user should know — context, caveats, or observations not covered above>
      </handoff-notes>

      <handoff-action>
      ## Tech Debt Observed
      <!-- REQUIRED. List tech debt, or write "Not Applicable". Do not omit this section. -->
      - <issues noticed but intentionally left out of scope of this change>

      ## Unresolved Decisions
      <!-- REQUIRED. List open decisions needing user input, or write "Not Applicable" if none. Do not omit this section. -->
      - <decision or question — options considered, recommendation if any>
      <Carry forward decisions still open from earlier handoffs in this chatroom. Remove items the user has resolved. Do not decide on the user's behalf unless they explicitly asked you to.>

      ## Manual steps
      <!-- REQUIRED. List manual steps outside the system, or write "Not Applicable". Do not omit this section. -->
      <steps the user must take outside the system — deploy, configure credentials, run commands, verify in production, etc.>
      </handoff-action>
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

      **Handoff Template (Builder → Planner)** — complete every section below. When a section or field does not apply, write \`Not Applicable\` — do not omit sections, principles, or XML wrappers:

      \`\`\`markdown
      ## Summary
      <what was implemented or attempted, in plain terms>

      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Principles
      <!-- REQUIRED: Complete every principle below. Write an explanation or "Not Applicable" for each — do not omit this section or skip any principle bullet. -->
      - **Semantic Consistency:** <how this work demonstrates semantic consistency, or Not Applicable>
      <!-- Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms. -->

      - **Organization & Maintainability:** <how this work demonstrates organization & maintainability, or Not Applicable>
      <!-- Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders. -->

      - **Reducing Optionality:** <how this work demonstrates reducing optionality, or Not Applicable>
      <!-- Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently. -->

      - **Static Evaluability and Provability:** <how this work demonstrates static evaluability and provability, or Not Applicable>
      <!-- Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order. -->

      - **No Revisit:** <how this work demonstrates no revisit, or Not Applicable>
      <!-- No Revisit: implemented in a way so the user does not have to revisit this implementation again. -->

      - **Leave It Better:** <how this work demonstrates leave it better, or Not Applicable>
      <!-- Leave It Better: leave the code in a slightly better state than before when touching files. -->

      ## Proof of Completion
      - [ ] I confirm the delegation brief is fully met: all (Required) files done, verified end-to-end, acceptance criteria pass
      <!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you modified>

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)

      ## Blockers / questions
      <!-- REQUIRED. List blockers, or write "Not Applicable". Do not omit this section. -->
      <anything needing planner decision>

      ## Notes for review
      <!-- REQUIRED. List review notes, or write "Not Applicable". Do not omit this section. -->
      <specific areas for planner to check>
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

      **Delegation Brief (Planner → Builder)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.

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
      List **every** file in this slice. Mark each file **(Required)** or **(Optional)** — all Required files must land before PR. For each file, state the exact change and paste the code the builder should match (no guessing).
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
      Cross-file types, interfaces, or patterns that apply beyond a single file. Omit if everything is already specified per-file above.

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
      - Include at least one check that the feature is **verified end-to-end**. Unit tests alone are insufficient for new features.

      ## What to avoid
      - <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
      - <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs">

      ## Skills to activate
      - <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder>

      ## Out of scope
      - <files or areas the builder must NOT touch in this slice>

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

      **Delegation Brief (Planner → Builder)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.

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
      List **every** file in this slice. Mark each file **(Required)** or **(Optional)** — all Required files must land before PR. For each file, state the exact change and paste the code the builder should match (no guessing).
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
      Cross-file types, interfaces, or patterns that apply beyond a single file. Omit if everything is already specified per-file above.

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
      - Include at least one check that the feature is **verified end-to-end**. Unit tests alone are insufficient for new features.

      ## What to avoid
      - <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
      - <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs">

      ## Skills to activate
      - <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder>

      ## Out of scope
      - <files or areas the builder must NOT touch in this slice>

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

      **Report Template (Solo → User)** — complete every section below. When a section or field does not apply, write \`Not Applicable\` — do not omit sections, principles, or XML wrappers:

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <what was accomplished, in plain terms — no references to prior messages>

      ## What changed
      <high-level view of what changed since the user's message>
      </handoff-overview>

      <!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

      <handoff-proofs>
      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="solo"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Planning
      <!-- REQUIRED. List planning steps, or write "Not Applicable" for trivial single-step tasks. Do not omit this section. -->
      - <step 1: concrete artifact or outcome>
      - <step 2: concrete artifact or outcome>

      ## Proof of Principles
      <!-- REQUIRED: Complete every principle below. Write an explanation or "Not Applicable" for each — do not omit this section or skip any principle bullet. -->
      - **Semantic Consistency:** <how this work demonstrates semantic consistency, or Not Applicable>
      <!-- Semantic Consistency: the organization of the code, the code and the functionality of the code use a consistent and well maintained set of terms. -->

      - **Organization & Maintainability:** <how this work demonstrates organization & maintainability, or Not Applicable>
      <!-- Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders. -->

      - **Reducing Optionality:** <how this work demonstrates reducing optionality, or Not Applicable>
      <!-- Reducing Optionality: code contains the minimum number of code paths to support the functionality required presently. -->

      - **Static Evaluability and Provability:** <how this work demonstrates static evaluability and provability, or Not Applicable>
      <!-- Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order. -->

      - **No Revisit:** <how this work demonstrates no revisit, or Not Applicable>
      <!-- No Revisit: implemented in a way so the user does not have to revisit this implementation again. -->

      - **Leave It Better:** <how this work demonstrates leave it better, or Not Applicable>
      <!-- Leave It Better: leave the code in a slightly better state than before when touching files. -->

      ## Proof of Completion
      - [ ] I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met
      <!-- Read context before handoff if not already done this task: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="solo"\`. State the context goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you (or the builder) modified>

      ## Backlog Tasks Implemented
      <!-- REQUIRED. List backlog items addressed, or write "Not Applicable" if none were in scope. Do not omit this section. -->
      - \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>

      ## Backlog Pending User Review Confirmation
      <!-- REQUIRED. Complete the attestation, or write "Not Applicable" if no backlog items apply. Do not omit this section. -->
      - [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` after the feature was verified end-to-end and a PR was raised for user review
      - PR URL(s): <link to PR(s)>

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)
      </handoff-proofs>

      <handoff-direction>
      ## What exists today
      <!-- REQUIRED. Describe current state after this work, or write "Not Applicable". Do not omit this section. -->
      <current state after this work — what the user can now do, what is in place, how the system behaves>

      ## Key Technical Decisions
      <!-- REQUIRED. List decisions, or write "Not Applicable". Do not omit this section. -->
      - <schema design, modules, interfaces, domain entities — what you chose and why>

      ## Key Tradeoffs
      <!-- REQUIRED. List tradeoffs, or write "Not Applicable". Do not omit this section. -->
      - <what was weighed against what, and why you chose this path>

      ## System Design
      <!-- REQUIRED. Include a mermaid diagram when the change has non-trivial structure, or write "Not Applicable". Do not omit this section. -->

      \`\`\`mermaid
      flowchart TD
          A[Component] --> B[Component]
      \`\`\`
      </handoff-direction>

      <handoff-notes>
      ## Notes
      <!-- REQUIRED. Write notes, or "Not Applicable" if none. Do not omit this section. -->
      <anything the user should know — context, caveats, or observations not covered above>
      </handoff-notes>

      <handoff-action>
      ## Tech Debt Observed
      <!-- REQUIRED. List tech debt, or write "Not Applicable". Do not omit this section. -->
      - <issues noticed but intentionally left out of scope of this change>

      ## Unresolved Decisions
      <!-- REQUIRED. List open decisions needing user input, or write "Not Applicable" if none. Do not omit this section. -->
      - <decision or question — options considered, recommendation if any>
      <Carry forward decisions still open from earlier handoffs in this chatroom. Remove items the user has resolved. Do not decide on the user's behalf unless they explicitly asked you to.>

      ## Manual steps
      <!-- REQUIRED. List manual steps outside the system, or write "Not Applicable". Do not omit this section. -->
      <steps the user must take outside the system — deploy, configure credentials, run commands, verify in production, etc.>
      </handoff-action>
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
    test(`${label} instructs omitting inapplicable sections`, () => {
      expect(template).toBeTruthy();
      if (label.includes('→ builder')) {
        expect(template).toMatch(/Omit fields that do not apply/);
      } else {
        expect(template).toMatch(/complete every section/);
      }
      expect(template).not.toMatch(/do not delete the section/i);
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
      'all (Required) files done, verified end-to-end, acceptance criteria pass'
    );
  });

  test('builder → planner includes verified end-to-end completion checkboxes', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'builder',
      toRole: 'planner',
      role: 'builder',
    });
    expect(template).toContain('verified end-to-end');
    expect(template).toContain('(Required) files done');
  });

  test('planner → user includes context-read HTML comment', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
      role: 'planner',
    });
    expect(template).toContain('<!-- Read context before handoff if not already done this task:');
    expect(template).toContain('chatroom context read');
  });

  test('solo → user includes context-read HTML comment', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'solo',
      fromRole: 'solo',
      toRole: 'user',
      role: 'solo',
    });
    expect(template).toContain('<!-- Read context before handoff if not already done this task:');
    expect(template).toContain('chatroom context read');
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

  test('builder → planner includes verified end-to-end completion checkboxes', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'builder',
      toRole: 'planner',
      role: 'builder',
    });
    expect(template).toContain('verified end-to-end');
    expect(template).toContain('(Required) files done');
  });

  test('planner → user backlog attestation requires verified end-to-end', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'user',
      role: 'planner',
    });
    expect(template).toContain('verified end-to-end and a PR was raised for user review');
    expect(template).not.toContain('because a PR has been raised for user review');
  });

  test('planner → builder requires verified end-to-end acceptance criteria', () => {
    const template = resolveDeliveredHandoffTemplate({
      teamId: 'duo',
      fromRole: 'planner',
      toRole: 'builder',
      role: 'planner',
      nativeIntegration: false,
    });
    expect(template).toContain('Unit tests alone are insufficient for new features');
    expect(template).toContain('(Required)');
  });
});
