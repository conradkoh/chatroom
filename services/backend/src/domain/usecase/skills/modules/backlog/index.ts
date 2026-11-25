import {
  backlogAddCommand,
  backlogUpdateCommand,
} from '../../../../../../prompts/cli/backlog/command';
import type { SkillModule } from '../../registry';
import { resolveSkillPromptRefs } from '../../shared/prompt-context';

export const backlogSkill: SkillModule = {
  skillId: 'backlog',
  name: 'Backlog Management',
  description:
    'Use when asked to list, add, update, score, mark for review, complete, close, export or import backlog items, or when a task includes an attached backlog item.',
  getPrompt: (ctx) => {
    const { cliEnvPrefix, chatroomId, role } = resolveSkillPromptRefs(ctx);
    return `You have been activated with the "backlog" skill.

## Command Reference

### List
\`\`\`
${cliEnvPrefix}chatroom backlog list --chatroom-id=${chatroomId} --role=${role}
\`\`\`
Options: \`--limit=<n>\`, \`--sort=date:desc|priority:desc\`, \`--filter=unscored\` (only items without a priority score)

The list output shows scoring info (complexity, value, priority) for each item if it has been scored.

### History
\`\`\`
${cliEnvPrefix}chatroom backlog history --chatroom-id=${chatroomId} --role=${role}
\`\`\`
Options: \`--from=YYYY-MM-DD\`, \`--to=YYYY-MM-DD\`, \`--limit=<n>\`

Defaults: last 30 days through today; shows completed and closed tasks in range.

Use \`history\` for finished work; use \`list\` for active backlog items.

### Add
Content via **stdin / heredoc** or \`--content-file\`:

\`\`\`
${backlogAddCommand({ cliEnvPrefix, chatroomId, role })}
\`\`\`

\`\`\`
${cliEnvPrefix}chatroom backlog add --chatroom-id=${chatroomId} --role=${role} --content-file=./task.md
\`\`\`

### Update
Replace the **text content** of an existing item. Allowed only while the item is in \`backlog\` status. Same input pattern as **add** (stdin/heredoc or \`--content-file\`).

\`\`\`
${backlogUpdateCommand({ cliEnvPrefix, chatroomId, role, backlogItemId: '<item-id>' })}
\`\`\`

\`\`\`
${cliEnvPrefix}chatroom backlog update --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id> --content-file=./revised.md
\`\`\`

Use **update** to revise a description in place instead of adding a superseding item.

### Score
**Requires at least one** of \`--complexity\`, \`--value\`, or \`--priority\` (you can combine multiple).

\`\`\`
${cliEnvPrefix}chatroom backlog score --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id> \\
  [--complexity=<low|medium|high>] \\
  [--value=<low|medium|high>] \\
  [--priority=<n>]
\`\`\`

\`--priority\` must be an integer (higher = more important). There is no enforced max in the CLI.

**Important**: Only score items that do not already have all three fields set (complexity, value, priority).
Check the list output — items showing "Score: ..." are already scored. Skip them to avoid overwriting.

### Complete
\`\`\`
${cliEnvPrefix}chatroom backlog complete --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id>
\`\`\`

\`complete\` takes only \`--chatroom-id\`, \`--role\`, and \`--backlog-item-id\`. Do not pass any force or override option: the server does not apply one, so \`complete\` behaves the same either way. Use it only under the rules in Lifecycle below.

### Reopen
\`\`\`
${cliEnvPrefix}chatroom backlog reopen --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id>
\`\`\`

### Mark for Review
\`\`\`
${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id>
\`\`\`

### Export
\`\`\`
${cliEnvPrefix}chatroom backlog export --chatroom-id=${chatroomId} --role=${role} [--path=<directory>]
\`\`\`
Exports all backlog items (status=\`backlog\`) to a \`backlog-export.json\` file in the specified directory.
Creates the directory if it doesn't exist.
Default path (if \`--path\` is omitted): \`<cwd>/.chatroom/exports/\`

### Import
\`\`\`
${cliEnvPrefix}chatroom backlog import --chatroom-id=${chatroomId} --role=${role} [--path=<directory>]
\`\`\`
Imports backlog items from a \`backlog-export.json\` file in the specified directory.
- **Idempotent**: skips items whose content already exists (matched by SHA-256 content hash)
- **Staleness warning**: warns if the export is older than 7 days
Default path (if \`--path\` is omitted): \`<cwd>/.chatroom/exports/\`

### Close
Retires an item as stale, superseded, or duplicate. **\`--reason\` is required** (audit trail).

\`\`\`
${cliEnvPrefix}chatroom backlog close --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id> --reason="duplicate of XYZ"
\`\`\`

⚠️ **RESTRICTED: Only use when the user explicitly asks you to close an item.**
Agents must NEVER close backlog items autonomously. If an item looks stale or already implemented, prefer \`mark-for-review\` so the user decides.

Give a concise, factual reason (e.g. \`User confirmed: shipped in PR #119\`).

### Delete
Soft-deletes an item from any status (backlog / pending_user_review / closed). The row is retained for
referential integrity, excluded from normal backlog lists, and cannot be reopened.

\`\`\`
${cliEnvPrefix}chatroom backlog delete --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id>
\`\`\`

⚠️ **RESTRICTED: Only use when the user explicitly asks you to delete an item.**
Agents must NEVER delete backlog items autonomously. For stale/superseded items, prefer \`close\` or \`mark-for-review\` so the user decides.

---

## Lifecycle

Backlog items move through explicit statuses. **When you raise a PR for user review, use \`mark-for-review\` — not \`complete\`.** Only mark \`complete\` after the PR is merged and verified (or the user confirms).

\`\`\`mermaid
stateDiagram-v2
    [*] --> backlog: user creates
    backlog --> pending_user_review: agent raises PR (mark-for-review)
    pending_user_review --> closed: user confirms / PR merged (complete)
    backlog --> closed: complete directly (complete)
    pending_user_review --> backlog: user sends back for rework (UI only - no CLI command)
    pending_user_review --> closed: close without completing (close)
    backlog --> closed: stale/superseded (close)
    closed --> backlog: reopen
\`\`\`

\`delete\` is a soft-delete to the terminal \`deleted\` status: the row is retained and cannot be reopened.

### Command decision table

| Situation | Command |
|-----------|---------|
| Fix PR opened, awaiting user review/merge | \`mark-for-review\` |
| PR merged and verified | \`complete\` |
| Stale/duplicate/won't fix | \`close --reason=...\` |
| Mistakenly completed early | \`reopen\` then \`mark-for-review\` |
| Retire a mistaken item so it leaves the backlog lists (soft-delete, cannot be undone) | \`delete\` (user-only) |

---

## Workflows

### 1. Score Unscored Items

\`\`\`mermaid
flowchart TD
  A([Start]) --> B[List backlog items]
  B --> C{Any unscored?}
  C -->|No| D([Done])
  C -->|Yes| E["Check item: does it already have complexity + value + priority set?"]
  E -->|Already scored| F[Skip — do not overwrite existing score]
  F --> C
  E -->|Not scored| G[Score item: complexity, value, priority]
  G --> C
\`\`\`

An item is "already scored" if the list output shows "Score: complexity=... | value=... | priority=...".

### 2. After Completing a Backlog Task (PR raised)

\`\`\`mermaid
flowchart TD
  A([Implementation complete]) --> B[Open PR for user review]
  B --> C["mark-for-review (NOT complete)"]
  C --> D[Report PR link + summary to user]
  D --> E([User reviews in Pending Review section])
\`\`\`

Moves item to \`pending_user_review\`. The user confirms completion (\`complete\`) or sends the item back for rework.

### 3. Continuous Backlog Execution

Only activate when the user explicitly instructs autonomous execution
(e.g. "work through the backlog", "autonomously implement backlog items").

\`\`\`mermaid
flowchart TD
  A([Start]) --> B[List all backlog items]
  B --> C{Any unscored?}
  C -->|Yes| D["Score only items missing complexity/value/priority\\n(skip already-scored items)"] --> E[Re-list]
  C -->|No| E
  E --> F["Select items: complexity=low AND value=high"]
  F --> G{Qualifying items?}
  G -->|No| H([Report to user — no high-ROI items found])
  G -->|Yes| I[Take next item]
  I --> J{Already implemented?\\nCheck codebase / recent commits}
  J -->|Yes — stale| K["Mark for review\\n(note: already implemented)"]
  J -->|No| L[Implement: code changes + PR]
  L --> K
  K --> M[Mark item for review]
  M --> N{More items?}
  N -->|Yes| I
  N -->|No| O[Report full summary to user]
  O --> P([Done])
\`\`\`

Stale item = backlog task already present in the codebase. Mark immediately; skip implementation.
ROI = low complexity × high value.

### 4. Backlog Cleanup

Follow these steps to clean up the backlog by identifying and closing stale items.

1. List all backlog items:
   \`\`\`
   ${cliEnvPrefix}chatroom backlog list --chatroom-id=${chatroomId} --role=${role}
   \`\`\`

2. For each item, assess staleness:
   - Read the content carefully
   - If the item is still valid but the **wording is wrong**, use \`backlog update\` to fix the description in place (do not add a duplicate item)
   - Check if already implemented (look at recent commits, PRs, or existing code)
   - Check if superseded by a newer backlog item

3. For stale items, mark for review:
   \`\`\`
   ${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=<item-id>
   \`\`\`
   **Important:** Always mark for review — do NOT close directly. Let the user confirm.

4. Report summary: items reviewed, marked for review, kept, needs clarification

### 5. Export / Import Backlog

Use export/import to transfer backlog items between workspaces or for backup.
Default path: \`<cwd>/.chatroom/exports/\` — omit \`--path\` to use this.

**Export workflow:**
\`\`\`mermaid
flowchart TD
  A([Start]) --> B["Export backlog"]
  B --> C["chatroom backlog export\\n(writes to <cwd>/.chatroom/exports/ by default)"]
  C --> D["File written: backlog-export.json"]
  D --> E([Done — report file path to user])
\`\`\`

**Import workflow:**
\`\`\`mermaid
flowchart TD
  A([Start]) --> B["Import backlog"]
  B --> C["chatroom backlog import\\n(reads from <cwd>/.chatroom/exports/ by default)"]
  C --> D{Staleness warning?}
  D -->|Yes — export > 7 days old| E["Warn user: export may be stale"]
  D -->|No| F["Import items (skip duplicates)"]
  E --> F
  F --> G["Report: total / imported / skipped"]
  G --> H([Done])
\`\`\`

**Key points:**
- Default path is \`<cwd>/.chatroom/exports/\` — no \`--path\` needed for standard usage
- Use \`--path=<dir>\` to override with a custom directory
- Imports are idempotent — running import twice with the same file won't create duplicates
- Each item is identified by a SHA-256 hash of its content`;
  },
};
