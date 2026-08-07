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

/** Shared layout for inline severity chips in handoff-action list items. */
const SEVERITY_CHIP_BASE_CLASS_NAME =
  'inline-flex shrink-0 items-center px-1.5 py-1 text-[9px] font-medium tracking-wide rounded-none align-middle mr-1 leading-none';

function getSeverityChipClassName(severity: HandoffSeverity): string {
  switch (severity) {
    case 'high':
      return 'bg-chatroom-status-error/15 text-chatroom-status-error';
    case 'medium':
      return 'bg-chatroom-status-warning/15 text-chatroom-status-warning';
    case 'low':
      return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400';
  }
}

export function getSeverityChipClassNames(severity: HandoffSeverity): string {
  return `${SEVERITY_CHIP_BASE_CLASS_NAME} ${getSeverityChipClassName(severity)}`;
}

export function getSeverityLabel(severity: HandoffSeverity): string {
  return severity;
}
