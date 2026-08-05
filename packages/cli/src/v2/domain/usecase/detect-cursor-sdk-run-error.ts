/**
 * Detects Cursor SDK run-level failures from harness log lines.
 * Triggers resume-first reopen (see CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS)
 * before clearing daemon-memory session snapshot.
 */

export function isCursorSdkRunErrorInLogs(logLines: readonly string[]): boolean {
  return logLines.some((line) => line.includes(' run-error]'));
}

export function formatCursorSdkRunErrorMessage(logLines: readonly string[]): string {
  const line = [...logLines].reverse().find((l) => l.includes(' run-error]'));
  return line?.trim() ?? 'Cursor SDK run failed';
}
