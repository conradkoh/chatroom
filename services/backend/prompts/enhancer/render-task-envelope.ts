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
    '- Single-turn only. No tools. No codebase exploration. No file reads. No shell commands. No research. No subagents.',
    '- Work only from <handoff-template> and <draft-handoff> — do not investigate the repository.',
    '- Focus on immediate improvements to the handoff: clearer goals, concrete details already implied by the draft, acceptance criteria, and delegation specificity.',
    '- Output must follow handoff-template structure exactly.',
    '- Improve detail and fidelity within the existing scope; do not add new requirements.',
    '- Return only the enhanced handoff markdown — no preamble.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
