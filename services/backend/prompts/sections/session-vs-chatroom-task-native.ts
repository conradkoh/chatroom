/**
 * Session vs Chatroom Task Section — Native Integration
 *
 * Two-level model for harnesses that receive tasks via daemon injection
 * instead of a get-next-task listen loop.
 */

import type { PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

export function getSessionVsChatroomTaskNativeSection(): PromptSection {
  const content = `## Two-Level Model: Session vs Chatroom Task

| Level | Name | Scope | Ends when |
|-------|------|-------|-----------|
| **A** | **Session** (harness turn) | The entire agent invocation — from startup to shutdown | You deliberately shut down or the harness exits |
| **B** | **Chatroom task** | One discrete unit of work **delivered by task injection** | You run \`handoff\` to pass work to the next role |

**Completing Level B does NOT end Level A.**
After every \`handoff\`, your session continues — the daemon injects the next chatroom task when ready.

### Session Lifecycle

A session starts when your harness launches you and ends only when the harness shuts down (or you explicitly stop).
Within a session, you process many chatroom tasks sequentially:

task injected → do work → \`handoff\` → task injected → do work → \`handoff\` → …

Never exit or stop after a handoff — that closes the session (Level A) before the user is done with you.

### Common Mistakes

❌ **Wrong:** Start a blocking listener to wait for tasks (native harnesses do not use this pattern).
✅ **Right:** Wait for the daemon to inject the next task into your session context.

❌ **Wrong:** Run \`handoff\`, then stop or wait for the user to re-invoke you.
✅ **Right:** Run \`handoff\`, then stay in session — the next task will be injected automatically.

❌ **Wrong:** Think "I finished the task, I'm done."
✅ **Right:** Think "I finished this chatroom task (Level B). The session (Level A) continues — wait for injection."`;

  return createSection('session-vs-chatroom-task-native', 'guidance', content);
}
