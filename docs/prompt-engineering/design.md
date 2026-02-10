# Prompt Engineering Design

Architecture for the chatroom prompt generation system.

---

## Core Principle

Every prompt an agent receives should be **contextually composed** from standalone sections, selected by three dimensions:

1. **Role** — what the agent does (builder, reviewer, planner)
2. **Team** — how the team is structured (pair, squad, custom)
3. **Workflow** — what the team is doing right now (implementing a feature, answering a question, doing discovery)

These three dimensions form a **selector context** that determines which sections to include. No section should be hardcoded into a delivery layer — instead, each delivery layer selects the appropriate sections based on the current context.

---

## Prompt Section Types

All prompt content falls into two categories:

### Knowledge Sections

**Purpose:** Provide understanding — "how things work."

These give the agent background context, identity, and reference material. They help the agent understand its environment without prescribing immediate action.

| Section | Example |
|---------|---------|
| Role identity | "You are the team coordinator responsible for..." |
| Team structure | "You coordinate a team of builder and reviewer" |
| Command reference | "Use `chatroom handoff --role=planner --next-role=builder`" |
| Review checklist | "Code correctness, error handling, security..." |
| Policies | Security policy, design policy, performance policy |
| Workflow diagram | `User → Planner → Builder → Reviewer → Planner → User` |

**Characteristics:**
- Stable across tasks — don't change between messages
- Can be summarized by the LLM without losing correctness
- Safe to repeat in init prompts for reinforcement after context summarization

### Guidance Sections

**Purpose:** Direct action — "what to do next."

These tell the agent what to do right now, given the current state. They are dynamic and context-dependent.

| Section | Example |
|---------|---------|
| Next action | "Run `wait-for-task` to resume listening" |
| Task-started reminder | "Task acknowledged as NEW FEATURE. Delegate to builder." |
| Current classification | "Current Task: QUESTION — respond directly" |
| Handoff options | "Available targets: builder, reviewer, user" |
| Restriction notices | "Only the planner can hand off to the user" |
| Progress reporting | "Send `report-progress` at milestones or when blocked" |

**Characteristics:**
- Dynamic — change based on workflow state, classification, availability
- Time-sensitive — should be near the top of the agent's context
- Should not be repeated without purpose — guidance bloat causes confusion

---

## Selector Context

The selector context determines which sections to include. It is defined by three dimensions:

```
SelectorContext = {
  role: 'builder' | 'reviewer' | 'planner' | string;
  team: 'pair' | 'squad' | string;
  workflow: 'new_feature' | 'question' | 'follow_up' | string;
}
```

### Role Dimension

Determines:
- Base role guidance (workflow, handoff rules, best practices)
- Role identity (title, description)
- Entry point behavior (classification vs acknowledgement)

### Team Dimension

Determines:
- Team-specific context block (who coordinates, availability)
- Handoff target overrides (squad: builder → planner, not → user)
- Available handoff roles
- Workflow variant (full team, planner+builder, solo)

### Workflow Dimension

Determines:
- Classification-specific reminders (decompose → delegate vs answer → handoff)
- Handoff restrictions (new_feature must go through reviewer)
- Review criteria (what to check for this type of work)

---

## Selector Functions

Each dimension provides selector functions that return standalone prompt sections:

```typescript
// Role selectors
getRoleIdentity(role: string): { title: string; description: string }
getRoleGuidance(role: string, ctx: SelectorContext): string    // knowledge
getRoleReminder(role: string, ctx: SelectorContext): string    // guidance

// Team selectors
getTeamContext(team: string, ctx: SelectorContext): string     // knowledge
getTeamHandoffRules(team: string, ctx: SelectorContext): string // knowledge
getTeamWorkflow(team: string, ctx: SelectorContext): string    // knowledge

// Workflow selectors
getWorkflowGuidance(workflow: string, ctx: SelectorContext): string  // guidance
getWorkflowReminder(workflow: string, ctx: SelectorContext): string  // guidance
```

**Key design rule:** Selector functions return standalone, self-contained sections. They do NOT embed other selector outputs. Composition happens at the delivery layer.

---

## Delivery Layers

Delivery layers are the points where prompts are assembled and sent to the agent. Each layer has a different purpose and selects different sections.

### Layer 1: Init Prompt

**When:** Agent joins the chatroom (once)
**Purpose:** Full agent setup — identity, context, commands, first action
**Assembly:** `composeSystemPrompt()`

```
┌─────────────────────────────────────────┐
│ KNOWLEDGE (heavy — full context load)   │
│                                         │
│  1. Role Identity (title, description)  │
│  2. Getting Started (context read, wft) │
│  3. Classification Guide (entry point)  │
│  4. Team Context (squad/pair rules)     │
│  5. Role Guidance (workflow, handoffs)   │
│  6. Command Reference (handoff, report) │
│                                         │
├─────────────────────────────────────────┤
│ GUIDANCE (light — first action only)    │
│                                         │
│  7. Handoff Options (available targets) │
│  8. Next Step (run wait-for-task)       │
│                                         │
└─────────────────────────────────────────┘
```

**Rationale:** The init prompt is the agent's first and most complete context. It front-loads all knowledge because it may be the only time the agent sees the full picture before context summarization compresses it.

### Layer 2: Task Delivery

**When:** Agent receives a task via `wait-for-task` (every task)
**Purpose:** Refresh role context + provide task-specific guidance
**Assembly:** `generateRolePrompt()` + task delivery wrapper

```
┌─────────────────────────────────────────┐
│ KNOWLEDGE (medium — refreshed context)  │
│                                         │
│  1. Role Identity (title, description)  │
│  2. Team Context (squad/pair rules)     │
│  3. Role Guidance (workflow, handoffs)   │
│  4. Available Actions (context, backlog)│
│                                         │
├─────────────────────────────────────────┤
│ GUIDANCE (medium — task-specific)       │
│                                         │
│  5. Current Classification context      │
│  6. Handoff Options (dynamic targets)   │
│  7. Commands (handoff, report, wft)     │
│  8. Wait-for-task reminder              │
│                                         │
└─────────────────────────────────────────┘
```

**Rationale:** By the time an agent receives a task, the init prompt may be summarized. The task delivery prompt refreshes the role knowledge and adds task-specific guidance. It is lighter than the init prompt because it omits the "Getting Started" and classification guide sections (the agent already knows how to use the system).

### Layer 3: Task-Started Reminder

**When:** Agent acknowledges a task via `task-started` (after classification)
**Purpose:** Focused guidance — "here's what to do next"
**Assembly:** `generateTaskStartedReminder()`

```
┌─────────────────────────────────────────┐
│ GUIDANCE ONLY (focused — immediate)     │
│                                         │
│  1. Acknowledgement confirmation        │
│  2. Workflow-specific next steps        │
│  3. Relevant handoff command            │
│  4. Task/message ID reference           │
│                                         │
└─────────────────────────────────────────┘
```

**Rationale:** This is a short, actionable prompt. No knowledge sections — the agent already has context from the task delivery. This layer is purely about directing the next action based on the classification and team structure.

### Layer 4: CLI Envelope

**When:** Before the init prompt (CLI provides this wrapper)
**Purpose:** Connectivity instructions — how to stay available
**Assembly:** `generateGeneralInstructions()` (via CLI)

```
┌─────────────────────────────────────────┐
│ KNOWLEDGE (connectivity)                │
│                                         │
│  1. Wait-for-task foreground rule       │
│  2. Timeout understanding               │
│  3. Backlog reminder                    │
│                                         │
└─────────────────────────────────────────┘
```

**Rationale:** These are agent-harness-level instructions that apply regardless of role, team, or workflow. They are provided once by the CLI and not duplicated in the backend prompt.

---

## Repetition Guidelines

### Acceptable Repetition

1. **Init prompt ↔ Task delivery:** Knowledge sections (role identity, team context, workflow) appear in both. This is intentional — the init prompt may be lost to context summarization, so the task delivery refreshes it.

2. **Progressive disclosure:** The same concept can appear as a brief reference first ("Available targets: builder, user") and as detailed rules later ("Handoff Rules: ..."). This serves different reading depths.

3. **Contextual framing:** The same fact can appear in a knowledge section (for understanding) and a guidance section (for action). Example: "You are the ONLY role that communicates with the user" (knowledge/identity) and "Hand off to `user` with a summary" (guidance/action).

### Unacceptable Repetition

1. **Same framing, same section:** If the same sentence appears twice within a single prompt delivery with the same framing and purpose, one instance should be removed.

2. **Contradictory statements:** If a knowledge section says "hand off to user" but a guidance section says "NEVER hand off to user", the knowledge section must be parameterized to reflect the actual team rules.

3. **Guidance bloat:** If the same instruction (e.g., "run wait-for-task") appears more than twice in a single prompt, reduce to the minimum needed for progressive disclosure.

---

## Composition vs. Inheritance

Team-specific prompts (squad builder, pair reviewer) **compose with** base prompts — they do NOT inherit and override. The pattern:

```
Squad Builder Prompt = TeamContext(squad, builder) + BaseBuilderGuidance(params)
```

The `TeamContext` block provides squad-specific rules. The `BaseBuilderGuidance` provides role-generic workflow. The base guidance accepts parameters (like `questionTarget`, `approvalTarget`) that the team wrapper can set to avoid contradictions.

**Why composition over inheritance:**
- Base guidance is always included — ensures core workflow is present
- Team context is a standalone block — clearly separated from base rules
- Parameters resolve contradictions at the boundary (e.g., squad sets `questionTarget: 'planner'`)

---

## Current Implementation Status

### Implemented
- [x] Role × Team composition (squad/pair wrappers + base guidance)
- [x] Parameterized handoff targets (`questionTarget`, `approvalTarget`)
- [x] Dynamic availability (`availableMembers` wired through generator)
- [x] Delivery layers (init, task delivery, task-started reminder)
- [x] Knowledge/guidance separation (implicit in current section structure)
- [x] SelectorContext type system (`types/sections.ts`)
- [x] SelectorContext adapters for role guidance (`fromContext.ts` in base/squad/pair)
- [x] Unified dispatcher (`getRoleGuidanceFromContext` in generator)
- [x] Standalone team context section (`sections/team-context.ts`)
- [x] Standalone role identity sections (`sections/role-identity.ts`)
- [x] Delivery layers migrated to SelectorContext dispatching
- [x] Task-started reminders using SelectorContext internally
- [x] Comprehensive squad workflow integration tests (20 tests)

### Not Yet Implemented
- [ ] Discovery workflow variant (no workflow beyond new_feature/question/follow_up)
- [ ] Section registry (no central manifest of what sections exist and where they're used)
- [ ] Full section-based compose path (delivery layers still use string assembly, not `composeSections()`)

---

## File Reference

```
services/backend/prompts/
├── generator.ts              # Main composer (delivery layers)
├── templates.ts              # Role identity (knowledge)
├── types/cli.ts              # Type definitions
├── utils/                    # CLI env prefix helpers
├── base/cli/
│   ├── roles/                # Base role guidance (knowledge)
│   │   ├── planner.ts
│   │   ├── builder.ts
│   │   └── reviewer.ts
│   ├── init/                 # Getting Started (knowledge)
│   ├── task-started/         # Classification guide + reminders (knowledge + guidance)
│   ├── handoff/              # Handoff command (knowledge)
│   ├── report-progress/      # Progress command (knowledge)
│   └── wait-for-task/        # Connectivity (knowledge + guidance)
├── teams/
│   ├── squad/prompts/        # Squad team context (knowledge)
│   │   ├── planner.ts
│   │   ├── builder.ts
│   │   └── reviewer.ts
│   └── pair/prompts/         # Pair team context (knowledge)
│       ├── builder.ts
│       └── reviewer.ts
└── policies/                 # Review policies (knowledge)
    ├── index.ts
    ├── security.ts
    ├── design.ts
    └── performance.ts
```
