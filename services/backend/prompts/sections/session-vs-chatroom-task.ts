/**
 * Session vs Chatroom Task Section
 *
 * Explains the two-level model every agent must internalize:
 *   Level A — the session (harness turn): stay alive, keep listening, never exit
 *   Level B — the chatroom task: the discrete unit of work delivered via get-next-task
 *
 * Completing Level B (handoff) does NOT end Level A.
 * The agent must always return to get-next-task to continue the session.
 */

import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Core two-level model table.
 * Suitable for insertion near the top of any role guidance section.
 */
export function getTwoLevelsTableSection(): string {
  return `## Two-Level Model: Session vs Chatroom Task

| Level | Name | Scope | Ends when |
|-------|------|-------|-----------|
| **A** | **Session** (harness turn) | The entire agent invocation — from startup to shutdown | You deliberately shut down or the harness exits |
| **B** | **Chatroom task** | One discrete unit of work delivered by \`get-next-task\` | You run \`handoff\` to pass work to the next role |

**Completing Level B does NOT end Level A.**
After every \`handoff\`, you must run \`get-next-task\` again to stay in the session and receive the next chatroom task.`;
}

/**
 * Session lifecycle paragraph.
 * Explains what a "session" means in practice.
 */
export function getSessionLifecycleSection(): string {
  return `### Session Lifecycle

A session starts when your harness launches you and ends only when the harness shuts down (or you explicitly stop).
Within a session, you process many chatroom tasks sequentially:

\`get-next-task\` → do work → \`handoff\` → \`get-next-task\` → do work → \`handoff\` → …

Never exit or stop after a handoff — that closes the session (Level A) before the user is done with you.`;
}

/**
 * Anti-patterns block.
 * Concise wrong/right bullets so agents recognize the failure modes.
 */
export function getSessionAntiPatternsSection(): string {
  return `### Common Mistakes

❌ **Wrong:** Run \`handoff\`, then stop or wait for the user to re-invoke you.
✅ **Right:** Run \`handoff\`, then immediately run \`get-next-task\` in the foreground.

❌ **Wrong:** Think "I finished the task, I'm done."
✅ **Right:** Think "I finished this chatroom task (Level B). The session (Level A) continues — run \`get-next-task\`."

❌ **Wrong:** Run \`get-next-task\` in the background or skip it.
✅ **Right:** \`get-next-task\` must run in the **foreground** so the harness can deliver the next task.`;
}

/**
 * Full composed section for the system prompt.
 * Combines table + lifecycle + anti-patterns into one PromptSection.
 */
export function getSessionVsChatroomTaskSection(): PromptSection {
  const content = [
    getTwoLevelsTableSection(),
    '',
    getSessionLifecycleSection(),
    '',
    getSessionAntiPatternsSection(),
  ].join('\n');

  return createSection('session-vs-chatroom-task', 'guidance', content);
}
