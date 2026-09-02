/**
 * Detects Cursor SDK run-level failures from harness log lines.
 * Triggers resume-first reopen (see CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS)
 * before clearing daemon-memory session snapshot.
 */

import { classifyResumeStormReason } from './classify-resume-storm-reason.js';

// fallow-ignore-next-line unused-export
export function isCursorSdkRunErrorInLogs(logLines: readonly string[]): boolean {
  return logLines.some((line) => line.includes(' run-error]'));
}

export function formatCursorSdkRunErrorMessage(logLines: readonly string[]): string {
  const line = [...logLines].reverse().find((l) => l.includes(' run-error]'));
  return line?.trim() ?? 'Cursor SDK run failed';
}

/** Cursor-sdk log lines with auth_error classification (spawn-error, status ERROR, ConnectError). */
export function isCursorSdkAuthErrorInLogs(logLines: readonly string[]): boolean {
  if (classifyResumeStormReason(logLines) !== 'auth_error') return false;
  return logLines.some((line) => line.includes('[cursor-sdk:'));
}

/**
 * Triggers resume-first reopen phase switching (see CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS).
 * Includes run-error AND cursor-sdk auth failures on spawn-error path.
 */
export function hasCursorSdkSessionReopenTrigger(logLines: readonly string[]): boolean {
  return isCursorSdkRunErrorInLogs(logLines) || isCursorSdkAuthErrorInLogs(logLines);
}
