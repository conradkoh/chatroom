import type { SkillModule } from '../../registry';

export const backlogSkill: SkillModule = {
  skillId: 'backlog',
  name: 'Backlog Reference',
  description: 'Full backlog command reference with scoring, completion, and workflow guides.',
  getPrompt: (cliEnvPrefix: string) => `You have been activated with the "backlog" skill.

## Command Reference

### List
\`\`\`
${cliEnvPrefix}chatroom backlog list --chatroom-id=<id> --role=<role>
\`\`\`
Status (optional, defaults to \`backlog\`): \`backlog\` | \`pending\` | \`in_progress\` | \`pending_user_review\` | \`active\` | \`all\`
Flags: \`--status=<status>\`, \`--limit=<n>\`, \`--full\`

The list output shows scoring info (complexity, value, priority) for each item if it has been scored.

### History
\`\`\`
${cliEnvPrefix}chatroom backlog history --chatroom-id=<id> --role=<role>
\`\`\`
Options: \`--from=YYYY-MM-DD\`, \`--to=YYYY-MM-DD\`, \`--status=<completed|closed>\`
Defaults: last 30 days, both completed and closed items.

Use \`history\` to see what was previously completed or cancelled. Use \`list\` for active items.

### Add
\`\`\`
${cliEnvPrefix}chatroom backlog add --chatroom-id=<id> --role=<role> --content="<content>"
\`\`\`

### Score
\`\`\`
${cliEnvPrefix}chatroom backlog score --chatroom-id=<id> --role=<role> --task-id=<id> \\
  --complexity=<low|medium|high> \\
  --value=<low|medium|high> \\
  --priority=<1-100>
\`\`\`

**Important**: Only score items that do not already have all three fields set (complexity, value, priority).
Check the list output — items showing "Score: ..." are already scored. Skip them to avoid overwriting.

### Complete
\`\`\`
${cliEnvPrefix}chatroom backlog complete --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

### Reopen
\`\`\`
${cliEnvPrefix}chatroom backlog reopen --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

### Mark for Review
\`\`\`
${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

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
ROI = low complexity × high value.`,
};
