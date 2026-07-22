const ANSI_ESCAPE = /\x1b\[([0-9;]*)m/g;
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
const URL_EXTRACT = /https?:\/\/[^\s<>"']+/;

const ANSI_COLORS: Record<number, string> = {
  30: '#71717a',
  31: 'var(--chatroom-status-error)',
  32: 'var(--chatroom-status-success)',
  33: 'var(--chatroom-status-warning)',
  34: 'var(--chatroom-status-info)',
  35: '#c084fc',
  36: '#22d3ee',
  37: 'var(--chatroom-text-primary)',
  90: '#52525b',
  91: '#f87171',
  92: '#34d399',
  93: '#fbbf24',
  94: '#60a5fa',
  95: '#e879f9',
  96: '#67e8f9',
  97: '#fafafa',
};

type AnsiState = {
  color?: string;
  bold: boolean;
};

export type LogTextSegment = {
  text: string;
  color?: string;
  bold: boolean;
};

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function applySingleSgrCode(code: number, state: AnsiState): AnsiState {
  if (code === 0) return { color: undefined, bold: false };
  if (code === 1) return { ...state, bold: true };
  if (code === 22) return { ...state, bold: false };
  if (code === 39) return { ...state, color: undefined };
  if (ANSI_COLORS[code]) return { ...state, color: ANSI_COLORS[code] };
  return state;
}

function applySgrCodes(codes: string, state: AnsiState): AnsiState {
  if (codes === '' || codes === '0') {
    return { color: undefined, bold: false };
  }

  return codes.split(';').reduce<AnsiState>((current, raw) => {
    const code = Number(raw);
    return Number.isNaN(code) ? current : applySingleSgrCode(code, current);
  }, state);
}

// fallow-ignore-next-line complexity
export function parseLogTextSegments(text: string): LogTextSegment[] {
  const segments: LogTextSegment[] = [];
  let state: AnsiState = { bold: false };
  let buffer = '';
  let lastIndex = 0;

  for (const match of text.matchAll(ANSI_ESCAPE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      buffer += text.slice(lastIndex, index);
    }
    if (buffer) {
      segments.push({ text: buffer, color: state.color, bold: state.bold });
      buffer = '';
    }
    state = applySgrCodes(match[1], state);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    buffer += text.slice(lastIndex);
  }
  if (buffer) {
    segments.push({ text: buffer, color: state.color, bold: state.bold });
  }

  return segments.length > 0 ? segments : [{ text, bold: false }];
}

export function splitUrls(text: string): { type: 'text' | 'url'; value: string }[] {
  const parts: { type: 'text' | 'url'; value: string }[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, index) });
    }
    parts.push({ type: 'url', value: match[1] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

export function extractFirstUrl(text: string): string | null {
  const match = stripAnsi(text).match(URL_EXTRACT);
  return match?.[0] ?? null;
}

export function collectUrlsFromLogLines(lines: { text: string }[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const line of lines) {
    const url = extractFirstUrl(line.text);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls;
}
