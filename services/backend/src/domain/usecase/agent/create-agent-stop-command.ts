import { applyAgentStopCommand, type ApplyAgentStopCommandInput } from './apply-agent-stop-command';
import { supersedeInflightAgentStopCommands } from './supersede-inflight-agent-stop-commands';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { interruptEnhancerJobsOnChatroomStop } from '../enhancer/interrupt-enhancer-jobs-on-chatroom-stop';

export type CreateAgentStopCommandInput = ApplyAgentStopCommandInput;
export type CreateAgentStopCommandResult = Awaited<ReturnType<typeof applyAgentStopCommand>>;

export async function createAgentStopCommand(
  ctx: MutationCtx,
  input: CreateAgentStopCommandInput
): Promise<CreateAgentStopCommandResult> {
  await supersedeInflightAgentStopCommands(ctx, { chatroomId: input.chatroomId });
  if (input.scope.kind === 'chatroom') {
    await interruptEnhancerJobsOnChatroomStop(ctx, input.chatroomId);
  }
  return applyAgentStopCommand(ctx, input);
}
