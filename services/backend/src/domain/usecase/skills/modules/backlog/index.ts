import type { SkillModule } from '../../registry';

export const backlogSkill: SkillModule = {
  skillId: 'backlog',
  name: 'Backlog Reference',
  description:
    'Full backlog command reference: list/add/update, scoring, completion, close, export/import, and workflow guides.',
  getPrompt: (cliEnvPrefix: string) => `You have been activated with the "backlog" skill.

## Command Reference

### List
\`\`\`
${cliEnvPrefix}chatroom backlog list --chatroom-id=<id> --role=<role>
\`\`\`
Options: \`--limit=<n>\`, \`--sort=date:desc|priority:desc\`, \`--filter=unscored\` (only items without a priority score)

The list output shows scoring info (complexity, value, priority) for each item if it has been scored.

### History
\`\`\`
${cliEnvPrefix}chatroom backlog history --chatroom-id=<id> --role=<role>
\`\`\`
Options: \`--from=YYYY-MM-DD\`, \`--to=YYYY-MM-DD\`, \`--limit=<n>\`

Defaults: last 30 days through today; shows completed and closed tasks in range.

Use \`history\` for finished work; use \`list\` for active backlog items.

### Add
Content via **stdin / heredoc** or \`--content-file\`:

\`\`\`
${cliEnvPrefix}chatroom backlog add --chatroom-id=<id> --role=<role> << 'EOF'
Your backlog item content here
EOF
\`\`\`

\`\`\`
${cliEnvPrefix}chatroom backlog add --chatroom-id=<id> --role=<role> --content-file=./task.md
\`\`\`

### Update
Replace the **text content** of an existing item. Allowed only while the item is in \`backlog\` status. Same input pattern as **add** (stdin/heredoc or \`--content-file\`).

\`\`\`
${cliEnvPrefix}chatroom backlog update --chatroom-id=<id> --role=<role> --backlog-item-id=<id> << 'EOF'
New content here
EOF
\`\`\`

\`\`\`
${cliEnvPrefix}chatroom backlog update --chatroom-id=<id> --role=<role> --backlog-item-id=<id> --content-file=./revised.md
\`\`\`

Use **update** to revise a description in place instead of adding a superseding item.

### Score
**Requires at least one** of \`--complexity\`, \`--value\`, or \`--priority\` (you can combine multiple).

\`\`\`
${cliEnvPrefix}chatroom backlog score --chatroom-id=<id> --role=<role> --backlog-item-id=<id> \\
  [--complexity=<low|medium|high>] \\
  [--value=<low|medium|high>] \\
  [--priority=<n>]
\`\`\`

\`--priority\` must be an integer (higher = more important). There is no enforced max in the CLI.

**Important**: Only score items that do not already have all three fields set (complexity, value, priority).
Check the list output — items showing "Score: ..." are already scored. Skip them to avoid overwriting.

### Complete
\`\`\`
${cliEnvPrefix}chatroom backlog complete --chatroom-id=<id> --role=<role> --backlog-item-id=<id> [-f|--force]
\`\`\`

Optional \`-f\` / \`--force\` is a registered flag (see \`chatroom backlog complete --help\`). It is **not** forwarded to the Convex mutation yet, so it does not change server behavior today; omit it unless your runbook says otherwise.

### Reopen
\`\`\`
${cliEnvPrefix}chatroom backlog reopen --chatroom-id=<id> --role=<role> --backlog-item-id=<id>
\`\`\`

### Mark for Review
\`\`\`
${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=<id> --role=<role> --backlog-item-id=<id>
\`\`\`

### Export
\`\`\`
${cliEnvPrefix}chatroom backlog export --chatroom-id=<id> --role=<role> [--path=<directory>]
\`\`\`
Exports all backlog items (status=\`backlog\`) to a \`backlog-export.json\` file in the specified directory.
Creates the directory if it doesn't exist.
Default path (if \`--path\` is omitted): \`<cwd>/.chatroom/exports/\`

### Import
\`\`\`
${cliEnvPrefix}chatroom backlog import --chatroom-id=<id> --role=<role> [--path=<directory>]
\`\`\`
Imports backlog items from a \`backlog-export.json\` file in the specified directory.
- **Idempotent**: skips items whose content already exists (matched by SHA-256 content hash)
- **Staleness warning**: warns if the export is older than 7 days
Default path (if \`--path\` is omitted): \`<cwd>/.chatroom/exports/\`

### Close
Retires an item as stale, superseded, or duplicate. **\`--reason\` is required** (audit trail).

\`\`\`
${cliEnvPrefix}chatroom backlog close --chatroom-id=<id> --role=<role> --backlog-item-id=<id> --reason="duplicate of XYZ"
\`\`\`

⚠️ **RESTRICTED: Only use when the user explicitly asks you to close an item.**
Agents must NEVER close backlog items autonomously. If an item looks stale or already implemented, prefer \`mark-for-review\` so the user decides.

Give a concise, factual reason (e.g. \`User confirmed: shipped in PR #119\`).

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

### 2. After Completing a Backlog Task

\`\`\`mermaid
flowchart TD
  A([Task complete]) --> B[Mark for review]
  B --> C[Hand off to user with summary]
  C --> D([Done])
\`\`\`

Marks item as \`pending_user_review\`. User confirms completion or sends back for rework.

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
  G -->|No| H([Hand off — no high-ROI items found])
  G -->|Yes| I[Take next item]
  I --> J{Already implemented?\\nCheck codebase / recent commits}
  J -->|Yes — stale| K["Mark for review\\n(note: already implemented)"]
  J -->|No| L[Implement: code changes + PR]
  L --> K
  K --> M[Mark item for review]
  M --> N{More items?}
  N -->|Yes| I
  N -->|No| O[Hand off to user with full summary]
  O --> P([Done])
\`\`\`

Stale item = backlog task already present in the codebase. Mark immediately; skip implementation.
ROI = low complexity × high value.

### 4. Backlog Cleanup

Follow these steps to clean up the backlog by identifying and closing stale items.

1. List all backlog items:
   \`\`\`
   ${cliEnvPrefix}chatroom backlog list --chatroom-id=<id> --role=<role>
   \`\`\`

2. For each item, assess staleness:
   - Read the content carefully
   - If the item is still valid but the **wording is wrong**, use \`backlog update\` to fix the description in place (do not add a duplicate item)
   - Check if already implemented (look at recent commits, PRs, or existing code)
   - Check if superseded by a newer backlog item

3. For stale items, mark for review:
   \`\`\`
   ${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=<id> --role=<role> --backlog-item-id=<item-id>
   \`\`\`
   **Important:** Always mark for review — do NOT close directly. Let the user confirm.

4. If you are the coordinator, delegate assessment to workers:
   - Builder checks codebase to determine if items are stale
   - Builder marks stale items for review and reports back

5. Report summary: items reviewed, marked for review, kept, needs clarification

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
- Each item is identified by a SHA-256 hash of its content`,
};
