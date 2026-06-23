/**
 * Shared classify step lines for task delivery next-steps.
 */

import { classifyCommand } from '../cli/classify/command';

export interface ClassifyNextStepParams {
  chatroomId: string;
  role: string;
  taskId: string;
  cliEnvPrefix: string;
}

/** Append numbered classify step + new_feature example. */
export function appendClassifyNextStepLines(
  lines: string[],
  params: ClassifyNextStepParams,
  stepNum: number
): void {
  const baseCmd = classifyCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    taskId: params.taskId,
    classification: 'question',
    cliEnvPrefix: params.cliEnvPrefix,
  }).replace('--origin-message-classification=question', '--origin-message-classification=<type>');

  lines.push(`${stepNum}. Classify → \`${baseCmd}\``);
  lines.push('');
  lines.push('   new_feature example:');
  lines.push(
    `   ${classifyCommand({
      chatroomId: params.chatroomId,
      role: params.role,
      taskId: params.taskId,
      classification: 'new_feature',
      title: '<title>',
      description: '<description>',
      techSpecs: '<tech-specs>',
      cliEnvPrefix: params.cliEnvPrefix,
    })}`
  );
}
