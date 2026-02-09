# 024 - Squad Team with Dynamic Workflows: Architecture

## Changes Overview

This plan introduces:

1. **New team configuration** for the squad team (planner/builder/reviewer)
2. **Dynamic workflow logic** that adapts based on available participants
3. **New role prompts** for the planner role
4. **Team availability context** injected into system prompts
5. **Backlog clearing mode** as a chatroom-level workflow flag

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

### Backend: Chatroom Schema

**File**: `services/backend/convex/schema.ts`

**Changes**:
- Add optional `workflowMode` field to `chatroom_rooms` (`'normal' | 'backlog_clearing'`)

### Backend: Team Readiness

**File**: `services/backend/convex/chatrooms.ts`

**Changes**:
- Update `getTeamReadiness` to support squad team
- Add query for available team members (active/waiting participants)

### Backend: Prompt Composition

**File**: `services/backend/convex/messages.ts`

**Changes**:
- Pass team availability to prompt generator when composing init prompts
- Include backlog clearing mode context when active

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

### D4: Backlog Clearing as Chatroom Mode

Backlog clearing is a chatroom-level mode, not a per-agent mode. When active, the planner's prompt includes autonomous backlog processing instructions.

**Rationale**: The mode affects the entire team's workflow (planner picks items, delegates to available members), so it should be a team-level setting.

### D5: Handoff Validation Adapts to Available Roles

When the builder hands off, the system checks if the reviewer is available. If not, the handoff goes to the planner instead. This is handled at the validation/routing level, not just the prompt level.

**Rationale**: Hard validation prevents accidental handoffs to unavailable roles, which would stall the workflow.

## Data Model Changes

### chatroom_rooms (modified)

```typescript
// New optional field
workflowMode: v.optional(v.union(
  v.literal('normal'),
  v.literal('backlog_clearing')
))
```

### No New Tables Required

The squad team uses existing infrastructure:
- `chatroom_participants` for tracking role availability
- `chatroom_tasks` for backlog management
- `chatroom_messages` for routing

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
