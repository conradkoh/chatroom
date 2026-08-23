/** Task intake when the team entry point receives request-first enhancer input. */

import { contextReadCommand } from '../cli/context/read';

export function getNativeEnhancerInputTaskIntake(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const contextReadCmd = contextReadCommand(ctx);
  return `### Start working

You received **independent enhancer design input** for the originating user request — this is not a new user message and not a review of your draft.

**Context Rule:** Do **not** run \`context new\` for this task. The pinned context for the user's request still applies — run \`${contextReadCmd}\` only if you need to refresh goals.

**Sequence:**
1. Use the enhancer response as your first planning input — verify the recommended design and repository evidence.
2. Validate its frontend and data design sections, then perform the research and implementation work that remains yours.
3. For large or multi-surface revisions, activate the defragmentation skill before delegating slices.
4. **Advisory only:** You verify and delegate; the enhancer output is not a finished implementation brief.
5. When ready, implement, delegate, or hand off to \`user\` as your team permits.
6. Do not re-run the enhancer for this originating user message.`;
}
