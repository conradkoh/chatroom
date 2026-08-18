import {
  sendAutomatedUserMessage,
  type SendAutomatedUserMessageResult,
} from './send-automated-user-message';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function enqueueUserMessageAtFront(
  ctx: MutationCtx,
  args: Parameters<typeof sendAutomatedUserMessage>[1]
): Promise<SendAutomatedUserMessageResult> {
  return sendAutomatedUserMessage(ctx, { ...args, enqueueAtFront: true });
}
