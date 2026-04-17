# Skill Disclosure Gap Analysis

## Executive Summary

Registry skills are **not automatically disclosed** to agents because the system prompt generation logic does not read from the `chatroom_eventStream` to find activated skills. While skill activation writes `skill.activated` events with full prompt content, these events are never injected into the agent's system prompt.

## Current Architecture

### 1. Skill Registry & Discovery

**Location**: `services/backend/src/domain/usecase/skills/registry.ts`

- Contains `SKILLS_REGISTRY` with all built-in skills
- Each skill module has: `skillId`, `name`, `description`, `getPrompt(cliEnvPrefix)`
- Skills: backlog, software-engineering, code-review, workflow, development-workflow

**Related Functions**:
- `listSkills()` - Returns summary view of all skills from registry
- `getSkill()` - Retrieves single skill by ID

### 2. Skill Activation Flow

**Location**: `services/backend/src/domain/usecase/skills/activate-skill.ts`

When `chatroom skill activate` is called:
1. Skill is looked up in registry
2. Prompt is generated with `cliEnvPrefix` injected
3. **`skill.activated` event is written to `chatroom_eventStream`** with full prompt content

**Event Structure** (from `services/backend/src/domain/entities/events.ts`):
```typescript
SkillActivatedEvent = {
  type: 'skill.activated';
  chatroomId: Id<'chatroom_rooms'>;
  skillId: string;
  skillName: string;
  role: string;
  prompt: string;  // ← Full skill prompt content
  timestamp: number;
}
```

### 3. System Prompt Generation

**Location**: `services/backend/prompts/generator.ts`

`composeInitPrompt()` builds the agent's system prompt, which includes:
- Team header (team name & structure)
- Role title & description
- **Glossary section** (from `prompts/sections/glossary.ts`)
- Getting started instructions
- Classification guide
- Role guidance (team-specific)
- Handoff options
- Commands reference
- Next steps

**Glossary Section** (`services/backend/prompts/sections/glossary.ts`):
- Lists known terms from `GLOSSARY_TERMS` constant
- Shows `(1 skill available)` for linked skills
- **Tells agents to run `chatroom skill list`** to discover available skills
- **Does NOT include activated skills or their prompts**

### 4. GetInitPrompt Query

**Location**: `services/backend/convex/messages.ts` line 2152

- Fetches the initialization prompt for agents
- Calls `composeInitPrompt()` to generate system prompt
- No reference to event stream or activated skills
- **Gap**: Does not query `chatroom_eventStream` for `skill.activated` events

### 5. Skill Customizations Table

**Location**: `services/backend/convex/chatroomSkillCustomizations.ts`

- Stores chatroom-specific skill customizations (overrides)
- Separate from the registry and skill activation mechanism
- Not used in current system prompt generation

## The Disclosure Gap

### What's Missing

**In the current flow:**
```
Agent starts → receives system prompt
System prompt includes glossary
Glossary says "run skill list to discover skills"
Agent manually discovers and activates skills
→ Event written to stream
→ But event never injected back into agent's context
```

**What should happen:**
```
Agent starts → receives system prompt
System prompt includes:
  1. Glossary of known skills
  2. List of ACTIVATED skills with their prompts
  3. Instructions on how to activate additional skills
→ Agent immediately knows what skills are available for this chatroom
```

### Specific Issues

1. **System Prompt Generation** doesn't read `chatroom_eventStream`
   - `composeInitPrompt()` only reads from team config, not events
   - No query to fetch `skill.activated` events

2. **Glossary Section** is generic
   - Same glossary shown to all agents regardless of activated skills
   - Doesn't reflect chatroom-specific skill activation state

3. **Skill Activation Events** are written but orphaned
   - Events contain full prompt content (with `cliEnvPrefix` injected)
   - Events are readable but never consumed for disclosure
   - No mechanism to list activated skills for a chatroom

4. **No Activated Skills Registry**
   - Can query all skills from registry
   - Can activate a skill (writes event)
   - But can't query "which skills are activated for this chatroom?"
   - No database index or query for this

## Required Changes for Auto-Disclosure

To enable automatic disclosure of activated skills to agents:

### 1. Query Active Skills by Chatroom

- Add query to find all `skill.activated` events for a chatroom
- Index on `(chatroomId, role, type)` to efficiently query by chatroom + skill.activated events
- Return active skills grouped by role or as unified list

### 2. Enhance System Prompt Generation

- Modify `composeInitPrompt()` to optionally query activated skills
- Create new section (or extend glossary) for "Activated Skills"
- Include full skill prompts for activated skills

### 3. Modify Glossary Section

- Split into "Known Skills" (registry) and "Activated Skills" (events)
- For activated skills, show full prompt instead of just "(1 skill available)"
- For known but unactivated skills, show discovery instructions

### 4. Consider Role-Specific Activation

- `skill.activated` event includes `role` field
- Should skills be role-specific, or chatroom-wide?
- Current design: activation is per-role, so different roles see different skills

## Code Entry Points for Implementation

1. **System Prompt Generation**:
   - `services/backend/prompts/generator.ts` - `composeInitPrompt()`
   - `services/backend/prompts/sections/glossary.ts` - `getGlossarySection()`

2. **Query Active Skills**:
   - `services/backend/convex/messages.ts` - extend or add new query
   - `services/backend/convex/skills.ts` - add query function

3. **Event Reading**:
   - `services/backend/src/domain/entities/events.ts` - already has `SkillActivatedEvent` type
   - Use Convex query to find recent `skill.activated` events

## Test Points

Check these test files for disclosure scenarios:
- `services/backend/tests/integration/cli/agent-system-prompt.spec.ts`
- `services/backend/tests/integration/cli/get-next-task-prompt.spec.ts`
- `services/backend/tests/integration/teams/squad/*/system-prompt.spec.ts`

## Additional Gaps Discovered

### Missing Glossary Entry

**CRITICAL**: The `development-workflow` skill exists in `SKILLS_REGISTRY` but is NOT in `GLOSSARY_TERMS`.

- Registry: 5 skills (backlog, software-engineering, code-review, workflow, development-workflow)
- Glossary: 4 skills (backlog, software-engineering, code-review, workflow)
- Missing: development-workflow

This means agents won't see development-workflow in the glossary section of their system prompt, even though:
- It's in the registry
- It can be listed via `chatroom skill list`
- It can be activated via `chatroom skill activate development-workflow`

### Test Coverage Gaps

Significant gaps in test coverage for skill disclosure:

1. **No Registry-Glossary Consistency Tests**
   - No test verifies all SKILLS_REGISTRY items appear in GLOSSARY_TERMS
   - Missing test would have caught development-workflow gap immediately

2. **No Activated Skill Disclosure Tests**
   - `skills.spec.ts` tests activation writes events but NOT consumption
   - No test verifies `skill.activated` events are read and injected into system prompt
   - Orphaned events are never detected

3. **Limited Prompt Generation Tests**
   - `agent-system-prompt.spec.ts` has snapshot tests but doesn't verify skill coverage
   - No test checks "all registry skills appear somewhere in prompt"
   - No test for development-workflow skill

4. **No Role-Specific Skill Tests**
   - `skill.activated` event includes `role` field
   - But no test verifies role-specific disclosure behavior
   - No test verifies same skill isn't duplicated for multiple roles

5. **No Individual Skill Prompt Tests**
   - Only `workflow-skill.spec.ts` exists
   - Missing: backlog, code-review, software-engineering, development-workflow

## Next Steps

1. **Add development-workflow to GLOSSARY_TERMS**
   - File: `services/backend/prompts/sections/glossary.ts`
   - Include skill name, description, and linkedSkillId

2. **Create query to fetch activated skills by chatroom**
   - Query format: `skills.getActivated(chatroomId, role?)`
   - Returns list of `skill.activated` events
   - Include cliEnvPrefix in prompt when needed

3. **Extend system prompt generation to include activated skills**
   - Modify `composeInitPrompt()` to optionally query activated skills
   - Create new section: "Activated Skills" with full prompts
   - Or extend "Glossary" to show activated skills with prompts

4. **Add comprehensive test coverage**
   - Registry-Glossary consistency check
   - Skill disclosure in system prompts
   - Activated skills in agent context
   - Individual skill prompt tests (all 5 skills)
   - Role-specific skill activation

5. **Verify role-specific activation behavior**
   - Document: Should skills be per-role or chatroom-wide?
   - Current design: role field on `skill.activated` event suggests per-role
   - May need separate "Activated Skills" section per role in prompt

## Test Files to Update

1. `services/backend/tests/integration/cli/agent-system-prompt.spec.ts`
   - Add test: verify all registry skills appear in glossary or activated section
   - Add test: verify development-workflow skill in glossary

2. `services/backend/convex/skills.spec.ts`
   - Add test: verify activated skills can be queried by chatroom
   - Add test: verify role-specific skill activation

3. `services/backend/tests/integration/skills/` (new tests)
   - Create: code-review-skill.spec.ts
   - Create: software-engineering-skill.spec.ts
   - Create: backlog-skill.spec.ts
   - Create: development-workflow-skill.spec.ts
   - Pattern: follow workflow-skill.spec.ts

4. `services/backend/tests/integration/cli/skill-disclosure.spec.ts` (new file)
   - Test: Registry-Glossary consistency
   - Test: Activated skills in system prompt
   - Test: Skill availability indicators in glossary
   - Test: CLI skill list vs Registry
