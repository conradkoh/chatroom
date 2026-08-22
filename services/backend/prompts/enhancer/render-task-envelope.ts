import { getDefragmentationReviewTriggerDescription } from './defragmentation-reference.js';
import { getUxReviewTriggerDescription } from './webapp-ux-reference.js';
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
    '- Investigate the repository independently before forming recommendations.',
    '- Return concrete planning input: intent and constraints, codebase grounding, recommended approach, risks, open questions, and next steps.',
    '- Stay within the user request; do not add requirements.',
    `- When ${getUxReviewTriggerDescription()}, complete the optional **UX** section in <output-template>. Write "Not Applicable." for non-UI tasks.`,
    `- When ${getDefragmentationReviewTriggerDescription()}, complete the optional **Defragmentation** section in <output-template>. Write "Not Applicable." only when no large or multi-surface revision is involved.`,
    '- Follow the output-template section order; **Implementation notes** must be last.',
    '- Run the CLI complete command as your final action. Stdout alone does not deliver planning input.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
