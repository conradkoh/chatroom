# 024 - Squad Team with Dynamic Workflows: Architecture

## Changes Overview

This plan introduces:

1. **New team configuration** for the squad team (planner/builder/reviewer)
2. **Dynamic workflow logic** that adapts based on available participants
3. **New role prompts** for the planner role
4. **Team availability context** injected into system prompts
5. **Prompt reuse** — builder/reviewer prompts shared between pair and squad via base role system

## New Components

### Backend: Squad Team Configuration

**Location**: `services/backend/prompts/teams/squad/`

Defines the squad team with its roles, entry point, and workflow rules.

```
services/backend/prompts/teams/squad/
├── config.ts       # Team definition (roles, entry point, name)
└── workflow.ts     # Squad-specific workflow guidance
```

### Backend: Planner Role Prompt

**Location**: `services/backend/prompts/base/cli/roles/planner.ts`

Role-specific prompt for the planner, including:
- User communication guidelines
- Task decomposition workflow
- Backlog management instructions
- Team coordination responsibilities

### Backend: Dynamic Workflow Resolver

**Location**: `services/backend/prompts/workflows/`

Logic to determine the correct workflow variant based on team availability.

```
services/backend/prompts/workflows/
├── resolver.ts     # Determines workflow variant from available roles
└── types.ts        # Workflow variant types
```

## Modified Components

### Backend: Prompt Generator

**File**: `services/backend/prompts/generator.ts`

**Changes**:
- Accept team availability context when composing prompts
- Include available team members in the system prompt
- Generate role-appropriate workflow guidance based on who's available
- Support squad team workflow generation

### Backend: Role Hierarchy

**File**: `services/backend/convex/lib/hierarchy.ts`

**Changes**:
- Add `planner` role with priority 0 (highest, above manager)
- Ensure planner routes correctly as entry point

### Backend: Team Readiness

**File**: `services/backend/convex/chatrooms.ts`

**Changes**:
- Update `getTeamReadiness` to support squad team
- Add query for available team members (active/waiting participants)

### Backend: Prompt Composition

**File**: `services/backend/convex/messages.ts`

**Changes**:
- Pass team availability to prompt generator when composing init prompts

## Design Decisions

### D1: Planner as Single Entry Point

The planner is always the entry point for squad teams. All user messages route to the planner, and only the planner can hand off to the user. This creates a clear communication boundary.

**Rationale**: Having a single coordinator prevents confusion when multiple roles are active and ensures the user gets consistent, synthesized responses.

### D2: Prompt-Based Role Fallback

When roles are unavailable, we handle fallback through the system prompt rather than the routing system. The planner's prompt includes: "Your team currently has: [builder, reviewer]" and workflow guidance adapts accordingly.

**Rationale**: This is simpler than building a routing-level fallback system. The AI model can follow role-specific guidance even when absorbing another role's responsibilities. It also means the system prompts work even for harnesses that deeply integrate with them.

### D3: Availability Checked at Prompt Time

Team availability is checked when composing the system prompt (at `getInitPrompt` / `wait-for-task` time), not continuously. If a role joins or leaves mid-task, the current task continues with the original workflow.

**Rationale**: Tasks are short-lived, and mid-task availability changes are rare. Checking at prompt time is simple and avoids complex real-time adaptation.

### D4: Handoff Validation Adapts to Available Roles

When the builder hands off, the system checks if the reviewer is available. If not, the handoff goes to the planner instead. This is handled at the validation/routing level, not just the prompt level.

**Rationale**: Hard validation prevents accidental handoffs to unavailable roles, which would stall the workflow.

## Data Model Changes

### No New Tables Required

The squad team uses existing infrastructure:
- `chatroom_participants` for tracking role availability
- `chatroom_tasks` for backlog management
- `chatroom_messages` for routing

## Prompt Reuse Architecture

The existing prompt system uses a two-layer architecture:

1. **Base role prompts** (`prompts/base/cli/roles/builder.ts`): Generic builder/reviewer guidance shared across all teams — workflow, git practices, classification, handoff rules
2. **Team-specific prompts** (`prompts/teams/pair/prompts/builder.ts`): Wraps base guidance with team context (e.g., "Pair Team Context"), then includes the base guidance

The squad team **reuses the same base role prompts** for builder and reviewer. The team-specific layer (`prompts/teams/squad/prompts/builder.ts`) adds squad context (e.g., "You work with a planner who coordinates", "Hand off to planner, not to user directly") but delegates core workflow to the shared base.

```
Base Builder Guidance (shared)
├── Pair Team Builder (adds pair context)
└── Squad Team Builder (adds squad context)
```

Only the **planner** role is new — it has no base role equivalent since it's a squad-specific concept.

## Prompt Structure

### Planner System Prompt Sections

1. **Team Identity**: "# Squad Team / ## Your Role: PLANNER"
2. **Team Availability**: "## Your Team / Available members: [builder, reviewer]" (dynamic)
3. **Getting Started**: CLI commands for context, wait-for-task, etc.
4. **Workflow Guidance**: Adapted based on available members
5. **Backlog Management**: Backlog commands and clearing mode instructions
6. **Handoff Rules**: Who to hand off to based on task type and availability
7. **Commands**: Handoff, report-progress, wait-for-task

### Builder/Reviewer System Prompts

Same as pair team prompts, but:
- Handoff targets include `planner` instead of `user`
- Workflow guidance references the planner as coordinator
