/**
 * Task intake guidance when planner receives enhancer planning feedback.
 */

export function getNativeEnhancerReviewTaskIntake(): string {
  return `### Start working

You received **enhancer planning feedback** on your check-in — this is not a new user message.

**Context Rule:** Do **not** run \`context new\` for this task. The pinned context for the user's request still applies — run \`context read\` only if you need to refresh goals.

**Sequence:**
1. Read the feedback sections below and revise your understanding or builder handoff draft.
2. If you **already delegated to builder** before this feedback arrived, **wait for the builder handback** — do not delegate again.
3. When ready, delegate to \`builder\` or hand off to \`user\` using the matching template.`;
}
