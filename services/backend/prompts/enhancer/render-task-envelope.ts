import { getUxReviewTriggerDescription, renderWebappUxReference } from './webapp-ux-reference.js';
import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface RenderEnhancerTaskEnvelopeParams {
  jobId: string;
  chatroomId: string;
  targetId: 'handoff:planner-to-builder';
  /** Inner `<handoff-templates>` markdown (output template only). */
  outputTemplateContent: string;
  /** Inner `<references>` XML (handoff-template wrappers). */
  referencesXml: string;
  plannerCheckIn: string;
  cliCompleteCommand: string;
}

export function renderEnhancerTaskEnvelope(params: RenderEnhancerTaskEnvelopeParams): string {
  const lines = [
    `<enhancer-job job-id="${escapeXmlAttribute(params.jobId)}" target="${escapeXmlAttribute(params.targetId)}" chatroom-id="${escapeXmlAttribute(params.chatroomId)}">`,
    '<handoff-templates>',
    escapeXmlText(params.outputTemplateContent),
    '</handoff-templates>',
    '<references>',
    params.referencesXml,
    '</references>',
    '<ux-reference>',
    escapeXmlText(renderWebappUxReference()),
    '</ux-reference>',
    '<planner-check-in>',
    escapeXmlText(params.plannerCheckIn),
    '</planner-check-in>',
    '<requirements>',
    '- Single-turn only. No subagents.',
    "- Read files and use tools as needed to understand the problem and validate the planner's proposal against the codebase.",
    '- Start from <handoff-templates>, <references>, and <planner-check-in>; supplement with targeted repo investigation when grounding is thin or claims need verification.',
    '- Critique the planner check-in (`<user-message>`, `<grounding>`, draft `<builder-handoff>`): user-intent assessment, knowledge gaps, reasoning errors, and delegation quality.',
    '- Output must follow the **Handoff to `planner`** section in <handoff-templates> (planning feedback, not a builder delegation brief).',
    '- Use `<handoff-template for="planner->builder">` and `<handoff-template for="planner->user">` in <references> to assess alignment with downstream delivery principles.',
    '- Tighten and correct within the existing scope; do not add new requirements.',
    '- Return only the feedback markdown — no preamble.',
    `- When ${getUxReviewTriggerDescription()}, run the UX review checklist in <ux-reference> and report under **Recommendations**. Write "Not Applicable." for non-UI tasks.`,
    '- Follow template section order; **Suggested edits** must be last (code examples only).',
    '- **Run the CLI complete command** as your final action. Stdout alone does NOT deliver feedback — the planner only receives feedback after you run complete.',
    '- If the plan needs no changes, still run complete with a brief "no changes needed" message. Skipping complete = your work is discarded.',
    '</requirements>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</enhancer-job>',
  ];
  return lines.join('\n');
}
