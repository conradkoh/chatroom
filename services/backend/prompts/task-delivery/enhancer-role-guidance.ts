import { handoffCommand } from '../cli/handoff/command';

export function appendEnhancerRoleTaskDeliveryGuidance(
  lines: string[],
  ctx: {
    chatroomId: string;
    role: string;
    cliEnvPrefix: string;
    entryPointRole: string;
    originUserMessageId?: string | undefined;
  }
): void {
  lines.push(
    '<enhancer-task>',
    '## Your enhancer task',
    'Recover the authoritative user request and history, inspect the repository, and return **one** complete recommended design.',
    ...(ctx.originUserMessageId ? [`Origin user message: \`${ctx.originUserMessageId}\``] : []),
    '</enhancer-task>',
    '',
    `Complete with a handoff to \`${ctx.entryPointRole}\` using the design-input template:`,
    '',
    '```bash',
    handoffCommand({
      chatroomId: ctx.chatroomId,
      role: 'enhancer',
      nextRole: ctx.entryPointRole,
      cliEnvPrefix: ctx.cliEnvPrefix,
    }),
    '```'
  );
}
