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

function modeRequirements(mode: 'search' | 'ask'): string[] {
  if (mode === 'search') {
    return [
      '- Return ranked findings with file paths, short excerpts, and relevance notes.',
      '- Keep results concise and scannable.',
      '- Include a ## Files section listing every referenced path.',
    ];
  }
  return [
    '- Return a concise answer in ## Summary and ## Results.',
    '- **Required:** include ## Grounding with path:line evidence for every claim.',
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
    ...modeRequirements(params.mode),
    '</requirements>',
    '<handoff-templates>',
    'Complete with: chatroom agentic-query complete --chatroom-id=<id> --query-id=<id> --role=workspace-agent',
    'Body must include ## Summary, ## Results, ## Grounding (required for ask), ## Files',
    '</handoff-templates>',
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
