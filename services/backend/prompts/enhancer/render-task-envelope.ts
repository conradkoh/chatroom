import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface RenderEnhancerTaskEnvelopeParams {
  jobId: string;
  chatroomId: string;
  targetId: 'handoff:planner-to-builder';
  handoffTemplate: string;
  draftHandoff: string;
  cliCompleteCommand: string;
}

export function renderEnhancerTaskEnvelope(params: RenderEnhancerTaskEnvelopeParams): string {
  const lines = [
    `<enhancer-job job-id="${escapeXmlAttribute(params.jobId)}" target="${escapeXmlAttribute(params.targetId)}" chatroom-id="${escapeXmlAttribute(params.chatroomId)}">`,
    '<handoff-template>',
    escapeXmlText(params.handoffTemplate),
    '</handoff-template>',
    '<draft-handoff>',
    escapeXmlText(params.draftHandoff),
    '</draft-handoff>',
    '<requirements>',
    '- Single-turn only. No tools. No research. No subagents.',
    '- Output must follow handoff-template structure exactly.',
    '- Improve detail and fidelity; do not change scope or add new requirements.',
    '- Return only the enhanced handoff markdown — no preamble.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
