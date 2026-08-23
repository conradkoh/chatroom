import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface RenderEnhancerTaskEnvelopeParams {
  jobId: string;
  chatroomId: string;
  originUserMessageId?: string;
  outputTemplateContent: string;
  requestContent: string;
  cliCompleteCommand: string;
}

export function renderEnhancerTaskEnvelope(params: RenderEnhancerTaskEnvelopeParams): string {
  const originAttribute = params.originUserMessageId
    ? ` origin-user-message-id="${escapeXmlAttribute(params.originUserMessageId)}"`
    : '';
  const lines = [
    `<enhancer-job job-id="${escapeXmlAttribute(params.jobId)}" chatroom-id="${escapeXmlAttribute(params.chatroomId)}"${originAttribute}>`,
    '<output-template>',
    escapeXmlText(params.outputTemplateContent),
    '</output-template>',
    '<forwarded-request>',
    escapeXmlText(params.requestContent),
    '</forwarded-request>',
    '<requirements>',
    '- Single-turn only. No subagents. Do not implement changes.',
    '- Download chatroom history from the origin user message before analysis; actual user messages are authoritative.',
    '- Investigate the repository independently before forming the design.',
    '- Return one complete recommended design: intent and constraints, repository evidence, Proof of Principles, frontend design, data design, open questions, and implementation sequence.',
    '- Stay within the user request; do not add requirements.',
    '- Do not propose multiple alternative approaches.',
    '- Complete <handoff-frontend-design> and <handoff-data-design> when applicable; write "Not Applicable." for sections that do not apply.',
    '- Follow the output-template section order; **Files touched (index)** must be last.',
    '- Run the CLI complete command as your final action. Stdout alone does not deliver design input.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
