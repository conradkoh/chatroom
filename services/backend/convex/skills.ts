import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { getAndIncrementQueuePosition, requireChatroomAccess } from './auth/cliSessionAuth';
import { createTask as createTaskUsecase } from '../src/domain/usecase/task/create-task';
import { getConfig } from '../prompts/config/index';
import { getCliEnvPrefix } from '../prompts/utils/index';

const config = getConfig();

// ---------------------------------------------------------------------------
// Built-in skill definitions
// ---------------------------------------------------------------------------

const BUILTIN_SKILLS = [
  {
    skillId: 'backlog',
    name: 'Backlog Reference',
    description: 'Full backlog command reference with scoring, completion, and workflow guides.',
    getPrompt: (cliEnvPrefix: string) => `You have been activated with the "backlog" skill.

## Command Reference

### List
\`\`\`
${cliEnvPrefix}chatroom backlog list --chatroom-id=<id> --role=<role> --status=<status>
\`\`\`
Status: \`backlog\` | \`pending\` | \`in_progress\` | \`completed\` | \`pending_review\` | \`all\`
Flags: \`--limit=<n>\`, \`--full\`

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
  C -->|Yes| E[Score item: complexity, value, priority]
  E --> C
\`\`\`

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
  C -->|Yes| D[Score all unscored items] --> E[Re-list]
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
  },
  {
    skillId: 'software-engineering',
    name: 'Software Engineering Reference',
    description: 'Implementation order, SOLID principles, and engineering standards.',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "software-engineering" skill.

## Implementation Order

\`\`\`mermaid
flowchart TD
  A([New Feature]) --> B["Domain Model\\ntypes · entities · invariants"]
  B --> C["Use Case Layer\\nbusiness logic · dependency inversion · pure · testable"]
  C --> D["Persistence Layer\\nschema · storage · migrations"]
  D --> E["Remaining\\nUI · integrations · cleanup · tests"]
\`\`\`

Each phase: shippable code, no scaffolding, one concern, clear acceptance criteria.
Always end with a cleanup phase: remove dead code, de-duplicate.

---

## SOLID Principles

- **S**ingle Responsibility — each module has one reason to change
- **O**pen/Closed — open for extension, closed for modification
- **L**iskov Substitution — subtypes must be substitutable for their base types
- **I**nterface Segregation — prefer many small, focused interfaces over one large one
- **D**ependency Inversion — depend on abstractions, not concretions

---

## Naming Conventions

Mutations: \`create\`, \`write\`, \`update\`
Queries: \`get\`, \`list\`, \`fetch\`
No mutations in "get" methods.`,
  },
] as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all built-in skills.
 * Reads directly from the BUILTIN_SKILLS constant — no DB access needed.
 */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return BUILTIN_SKILLS.map((s) => ({
      skillId: s.skillId,
      name: s.name,
      description: s.description,
      type: 'builtin' as const,
    }));
  },
});

/**
 * Fetch a single skill by skillId.
 * Reads directly from BUILTIN_SKILLS — returns null if not found.
 * Accepts convexUrl to inject cliEnvPrefix into the prompt.
 */
export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const skill = BUILTIN_SKILLS.find((s) => s.skillId === args.skillId);
    if (!skill) return null;

    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));

    return {
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
      type: 'builtin' as const,
      isEnabled: true,
      prompt: skill.getPrompt(cliEnvPrefix),
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Activate a skill for a chatroom.
 * Looks up the skill directly from BUILTIN_SKILLS and creates a pending task
 * whose content is the skill's prompt (with cliEnvPrefix injected).
 */
export const activate = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
    role: v.string(),
    convexUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Look up directly from constants — no DB seeding needed
    const skill = BUILTIN_SKILLS.find((s) => s.skillId === args.skillId);

    if (!skill) {
      throw new ConvexError(`Skill "${args.skillId}" not found or is disabled.`);
    }

    const cliEnvPrefix = getCliEnvPrefix(config.getConvexURLWithFallback(args.convexUrl));

    // Get queue position atomically
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    // Create a pending task whose content is the skill prompt (with env prefix)
    await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.role,
      content: skill.getPrompt(cliEnvPrefix),
      forceStatus: 'pending',
      queuePosition,
      origin: 'chat',
    });

    return {
      success: true,
      skill: {
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
      },
    };
  },
});
