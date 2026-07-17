import { escapeXmlAttribute, escapeXmlText } from '../attachments/xml.js';

export interface AgenticQueryTurnContext {
  seq: number;
  userMessage: string;
  assistantResponse?: string;
}

export interface RenderAgenticQueryEnvelopeParams {
  queryId: string;
  chatroomId: string;
  mode: 'search' | 'ask';
  workspace: {
    machineId: string;
    workingDir: string;
    hostname: string;
  };
  userMessage: string;
  priorTurns?: AgenticQueryTurnContext[];
  cliCompleteCommand: string;
}

function renderPriorTurns(turns: AgenticQueryTurnContext[]): string[] {
  if (turns.length === 0) return [];
  const lines = ['<prior-turns>'];
  for (const turn of turns) {
    lines.push(`<turn seq="${turn.seq}">`, '<user>', escapeXmlText(turn.userMessage), '</user>');
    if (turn.assistantResponse) {
      lines.push('<assistant>', escapeXmlText(turn.assistantResponse), '</assistant>');
    }
    lines.push('</turn>');
  }
  lines.push('</prior-turns>');
  return lines;
}

function modeRequirements(): string[] {
  return [
    '- Return ranked findings or a concise answer in ## Summary and ## Results.',
    '- Include ## Grounding with path:line evidence when making factual claims.',
    '- Include a ## Files section listing every referenced path.',
  ];
}

/** Returns lines for full <agentic-query>...</agentic-query> envelope. */
function renderAgenticQueryEnvelopeLines(params: RenderAgenticQueryEnvelopeParams): string[] {
  const lines: string[] = [
    `<agentic-query query-id="${escapeXmlAttribute(params.queryId)}" mode="${escapeXmlAttribute(params.mode)}" chatroom-id="${escapeXmlAttribute(params.chatroomId)}">`,
    '<workspace>',
    `<machine-id>${escapeXmlText(params.workspace.machineId)}</machine-id>`,
    `<working-dir>${escapeXmlText(params.workspace.workingDir)}</working-dir>`,
    `<hostname>${escapeXmlText(params.workspace.hostname)}</hostname>`,
    '</workspace>',
    '<query>',
    escapeXmlText(params.userMessage),
    '</query>',
    ...renderPriorTurns(params.priorTurns ?? []),
    '<requirements>',
    ...modeRequirements(),
    '</requirements>',
    '<complete>',
    'Submit via: chatroom agentic-query complete --chatroom-id=<id> --query-id=<id>',
    'Body: markdown only with ## Summary, ## Results, optional ## Grounding, ## Files -- no protocol markers.',
    '</complete>',
    '<cli-complete-command>',
    escapeXmlText(params.cliCompleteCommand),
    '</cli-complete-command>',
    '</agentic-query>',
  ];
  return lines;
}

export function renderAgenticQueryEnvelope(params: RenderAgenticQueryEnvelopeParams): string {
  return renderAgenticQueryEnvelopeLines(params).join('\n');
}
