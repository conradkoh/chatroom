export type HandoffSeverity = 'high' | 'medium' | 'low';

export interface SeverityBullet {
  severity: HandoffSeverity | null;
  text: string;
}

const SEVERITY_PREFIX_RE = /^\[(high|medium|low)\]\s*/i;

export function parseSeverityBullet(line: string): SeverityBullet {
  const trimmed = line.trim();
  const withoutListMarker = trimmed.replace(/^[-*]\s+/, '');
  const match = SEVERITY_PREFIX_RE.exec(withoutListMarker);
  if (!match) return { severity: null, text: trimmed };
  return {
    severity: match[1].toLowerCase() as HandoffSeverity,
    text: withoutListMarker.slice(match[0].length).trim(),
  };
}

export function getSeverityChipClassName(severity: HandoffSeverity): string {
  switch (severity) {
    case 'high':
      return 'bg-chatroom-status-error/15 text-chatroom-status-error border-chatroom-status-error/30';
    case 'medium':
      return 'bg-chatroom-status-warning/15 text-chatroom-status-warning border-chatroom-status-warning/30';
    case 'low':
      return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
  }
}

export function getSeverityLabel(severity: HandoffSeverity): string {
  return severity;
}
