/**
 * Detects Cursor SDK run-level failures from harness log lines.
 *
 * When a run ends with status `error`, crash recovery should not try
 * Agent.resume on the same harness session — cold spawn is more reliable.
 */

export function isCursorSdkRunErrorInLogs(logLines: readonly string[]): boolean {
  return logLines.some((line) => line.includes(' run-error]'));
}

export function formatCursorSdkRunErrorMessage(logLines: readonly string[]): string {
  const line = [...logLines].reverse().find((l) => l.includes(' run-error]'));
  return line?.trim() ?? 'Cursor SDK run failed';
}
