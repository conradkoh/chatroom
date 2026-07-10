export const LOG_HEAD_LINE_COUNT = 100;

export function formatLogHead(fullOutput: string): string {
  const lines = fullOutput.split('\n');
  if (lines.length <= LOG_HEAD_LINE_COUNT) return fullOutput;
  return `${lines.slice(0, LOG_HEAD_LINE_COUNT).join('\n')}\n… (${lines.length - LOG_HEAD_LINE_COUNT} more lines)`;
}

export function formatLogHeadFromLines(lines: string[]): string {
  return formatLogHead(lines.join('\n'));
}
