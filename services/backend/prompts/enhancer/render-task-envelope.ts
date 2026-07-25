import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface RenderEnhancerTaskEnvelopeParams {
  jobId: string;
  chatroomId: string;
  targetId: 'handoff:planner-to-builder';
  /** Inner `<handoff-templates>` markdown (wrapper added by envelope). */
  referenceHandoffTemplatesContent: string;
  plannerCheckIn: string;
  cliCompleteCommand: string;
}

export function renderEnhancerTaskEnvelope(params: RenderEnhancerTaskEnvelopeParams): string {
  const lines = [
    `<enhancer-job job-id="${escapeXmlAttribute(params.jobId)}" target="${escapeXmlAttribute(params.targetId)}" chatroom-id="${escapeXmlAttribute(params.chatroomId)}">`,
    '<handoff-templates>',
    escapeXmlText(params.referenceHandoffTemplatesContent),
    '</handoff-templates>',
    '<planner-check-in>',
    escapeXmlText(params.plannerCheckIn),
    '</planner-check-in>',
    '<requirements>',
    '- Single-turn only. No tools. No codebase exploration. No file reads. No shell commands. No research. No subagents.',
    '- Work only from <handoff-templates> and <planner-check-in> — do not investigate the repository.',
    '- Critique the planner check-in (`<user-message>`, `<grounding>`, draft `<builder-handoff>`): user-intent assessment, knowledge gaps, reasoning errors, and delegation quality.',
    '- Output must follow the **Handoff to `planner`** section in <handoff-templates> (planning feedback, not a builder delegation brief).',
    '- Use **Handoff to `builder`** and **Handoff to `user`** in <handoff-templates> to assess alignment with downstream delivery principles.',
    '- Tighten and correct within the existing scope; do not add new requirements.',
    '- Return only the feedback markdown — no preamble.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
