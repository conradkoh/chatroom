/** Task intake when the planner receives request-first enhancer input. */

import { contextReadCommand } from '../cli/context/read';

export function getNativeEnhancerInputTaskIntake(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const contextReadCmd = contextReadCommand(ctx);
  return `### Start working

You received **independent enhancer planning input** for the originating user request — this is not a new user message and not a review of a planner draft.

**Context Rule:** Do **not** run \`context new\` for this task. The pinned context for the user's request still applies — run \`${contextReadCmd}\` only if you need to refresh goals.

**Sequence:**
1. Use the enhancer response as your first planning input.
2. Validate its findings, then perform planner-owned research and design.
3. **Advisory only:** You make the final call; the enhancer output is not a finished builder brief.
4. When ready, delegate to \`builder\` or hand off to \`user\` using the matching template.
5. Do not re-run the enhancer for this originating user message.`;
}
