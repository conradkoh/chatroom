# Prompt Engineering Guidelines

## Overview

This document outlines the principles and guidelines for writing effective prompts in the chatroom system. The focus is on creating outcome-driven, rationale-based prompts that help agents understand both **why** they should take actions and **how** to accomplish them.

## Core Principles

### 1. Outcome + Rationale Over Instructions

Instead of prescribing what agents **must** do, explain the **outcome** they should achieve and the **rationale** behind it.

**❌ Bad (Instruction-based):**

> "Always hand off: Every task must end with a handoff"

**✅ Good (Outcome + Rationale):**

> "Transfer work via `handoff`: Each task needs clear completion so the next agent can continue the work"

### 2. Explicit CLI Command References

Always reference specific CLI commands using backticks when they are relevant to the action. This helps agents identify exact commands to run.

**❌ Bad (Vague reference):**

> "Stay connected to the chatroom"

**✅ Good (Explicit command):**

> "Use `wait-for-task` to stay connected to the chatroom"

### 3. Positive Framing Over Negative

Frame guidance in terms of what to achieve rather than what to avoid.

**❌ Bad (Negative framing):**

> "Never leave the wait-for-task process stopped"

**✅ Good (Positive framing):**

> "Message availability is critical: Use `wait-for-task` to remain available"

### 4. Cause-Effect Relationships

Clearly explain the consequences of actions (or inaction) to help agents make informed decisions.

**❌ Bad (No rationale):**

> "Restart immediately after unexpected termination"

**✅ Good (Clear consequence):**

> "Maintain message availability: Use `wait-for-task` to stay connected to the chatroom, otherwise users won't be able to reach you"

## Pattern Transformations

### Command → Purpose

Transform direct commands into purpose-driven statements.

| Before (Command)  | After (Purpose)                |
| ----------------- | ------------------------------ |
| "Always hand off" | "Transfer work via `handoff`"  |
| "Stay focused"    | "Focus on your assigned scope" |
| "Be thorough"     | "Include detailed summaries"   |

### Prohibition → Explanation

Replace prohibitions with explanations of the current state.

| Before (Prohibition)      | After (Explanation)                                                  |
| ------------------------- | -------------------------------------------------------------------- |
| "Do NOT run task-started" | "Task already acknowledged - The builder already ran `task-started`" |
| "Don't be vague"          | "Be specific and clear"                                              |

### Rule → Benefit

Transform rules into benefits that explain why they exist.

| Before (Rule)        | After (Benefit)                                      |
| -------------------- | ---------------------------------------------------- |
| "Format in Markdown" | "Use markdown formatting for clarity"                |
| "Complete your task" | "Complete your specific task to prevent scope creep" |

## Specific Guidelines

### Handoff Instructions

When describing handoffs:

1. **Reference the command**: Use `\`handoff\`` explicitly
2. **Explain the purpose**: "Transfer work so the next agent can continue"
3. **Provide context**: "Each task needs clear completion"

**Example:**

> "Transfer work via `\`handoff\``: Each task needs clear completion so the next agent can continue the work. To ask questions, use `\`handoff\`` to transfer to user."

### Wait-for-Task Instructions

When describing wait-for-task:

1. **Reference the command**: Use `\`wait-for-task\`` explicitly
2. **Explain the outcome**: "Stay connected to receive messages"
3. **Explain the consequence**: "Users won't be able to reach you"

**Example:**

> "Maintain message availability: Use `\`wait-for-task\`` to stay connected to the chatroom, otherwise users won't be able to reach you with messages"

### Task-Started Instructions

When describing task-started:

1. **Reference the command**: Use `\`task-started\`` when relevant
2. **Explain the context**: "Task already acknowledged"
3. **Focus on current action**: "Focus on the work itself"

**Example:**

> "Task already acknowledged - The builder already ran `\`task-started\`` to classify this task, so you can focus on the work itself"

### Review and Feedback Instructions

When describing review processes:

1. **Reference handoff**: Use `\`handoff\`` for feedback delivery
2. **Explain the purpose**: "Specific feedback enables action"
3. **Provide clarity**: "Clear guidance helps the builder make the right changes"

**Example:**

> "Be specific and clear in your `\`handoff\`` message: Vague feedback leads to confusion and rework"

## Real-World Examples

### Before and After Comparisons

#### Example 1: Task Completion

**Before:**

> "Always hand off: Every task must end with a handoff. To ask questions, hand off to user with your question."

**After:**

> "Transfer work via `\`handoff\``: Each task needs clear completion so the next agent can continue the work. To ask questions, use `\`handoff\`` to transfer to user."

#### Example 2: Process Termination

**Before:**

> "IMPORTANT: If the wait-for-task process terminates for ANY reason, you MUST immediately restart it"

**After:**

> "IMPORTANT: If the `\`wait-for-task\``process terminates for ANY reason, use`\`wait-for-task\`` immediately to stay connected and receive all messages from users and other agents"

#### Example 3: Code Quality

**Before:**

> "Reject messy code. Quality is non-negotiable"

**After:**

> "Maintain code quality: Use `\`handoff\`` to reject messy code that creates technical debt and slows future development"

#### Example 4: Message Formatting

**Before:**

> "Format in Markdown: Your handoff message should be formatted in markdown for readability"

**After:**

> "Use markdown formatting in your `\`handoff\`` message: Clear formatting helps the next agent quickly understand your work and decisions"

## Implementation Checklist

When writing or updating prompts, verify:

- [ ] **CLI commands are in backticks**: `\`handoff\``, `\`wait-for-task\``, `\`task-started\``
- [ ] **Outcomes are clear**: What should the agent achieve?
- [ ] **Rationales are provided**: Why should they do it?
- [ ] **Consequences are explained**: What happens if they don't?
- [ ] **Language is positive**: Focus on what to do, not what to avoid
- [ ] **Instructions are actionable**: Agent knows exactly how to proceed

## Common Pitfalls to Avoid

### 1. Vague References

**❌ Bad:** "Stay connected"
**✅ Good:** "Use `\`wait-for-task\`` to stay connected"

### 2. Missing Rationale

**❌ Bad:** "Always run after handoff"
**✅ Good:** "Continue receiving messages after `\`handoff\``"

### 3. Negative Framing

**❌ Bad:** "Don't miss messages"
**✅ Good:** "Message availability is critical"

### 4. Implementation Details in User-Facing Text

**❌ Bad:** "Handle SIGTERM signals"
**✅ Good:** "Handle unexpected termination"

## Testing Guidelines

When testing prompts:

1. **Read from agent perspective**: Is it clear what to do and why?
2. **Check CLI command accuracy**: Are command names and syntax correct?
3. **Verify outcome clarity**: Can the agent tell when they've succeeded?
4. **Test edge cases**: Does the guidance help when things go wrong?
5. **Ensure consistency**: Are similar patterns used throughout?

## Maintenance

- Review prompts quarterly for consistency with these guidelines
- Update CLI command references when commands change
- Ensure new prompts follow these patterns
- Collect feedback from agent interactions to improve clarity

---

_These guidelines were developed based on the prompt refactoring work completed in January 2026, focusing on converting instruction-based language to outcome-driven, rationale-based communication with explicit CLI command references._
