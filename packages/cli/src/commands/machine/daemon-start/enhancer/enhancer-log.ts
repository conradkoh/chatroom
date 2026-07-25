export const ENHANCER_LOG_PREFIX = '[enhancer]';

export function formatEnhancerLogLine(message: string): string {
  const trimmed = message.trimEnd();
  if (trimmed.startsWith(ENHANCER_LOG_PREFIX)) return trimmed;
  return `${ENHANCER_LOG_PREFIX} ${trimmed}`;
}

export function writeEnhancerLog(message: string): void {
  process.stdout.write(`${formatEnhancerLogLine(message)}\n`);
}
