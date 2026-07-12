/**
 * Shared context header + staleness warnings for task delivery (CLI and native).
 * Emits <context> XML wrapper.
 */

import { contextNewCommand } from '../cli/context/new';

export interface TaskDeliveryContextWindow {
  currentContext?: {
    elapsedHours: number;
  } | null;
  originMessage?: {
    senderRole: string;
  } | null;
  followUpCountSinceOrigin?: number;
  originMessageCreatedAt?: number | null;
}

export interface TaskDeliveryContextSectionParams extends TaskDeliveryContextWindow {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  isEntryPoint: boolean;
  /** Defaults to Date.now(); inject in tests for deterministic age checks. */
  nowMs?: number;
}

type ContextUpdateParams = Pick<
  TaskDeliveryContextSectionParams,
  'chatroomId' | 'role' | 'cliEnvPrefix' | 'isEntryPoint'
>;

function appendContextUpdateHint(lines: string[], params: ContextUpdateParams): void {
  const { chatroomId, role, cliEnvPrefix, isEntryPoint } = params;
  if (!isEntryPoint) return;
  const cmd = contextNewCommand({ chatroomId, role, cliEnvPrefix });
  lines.push('  <context-update-hint>');
  lines.push('    Update →');
  lines.push('    ```bash');
  lines.push(...cmd.split('\n').map((l) => `    ${l}`));
  lines.push('    ```');
  lines.push('  </context-update-hint>');
}

function appendContextHeader(lines: string[], contextReadLine: string): void {
  lines.push('<context>');
  lines.push(`  <hint>${contextReadLine}</hint>`);
}

function appendContextClose(lines: string[]): void {
  lines.push('</context>');
}

function appendElapsedContextStaleness(
  lines: string[],
  elapsedHours: number,
  updateParams: ContextUpdateParams
): void {
  if (elapsedHours >= 24) {
    const ageDays = Math.floor(elapsedHours / 24);
    lines.push(`  <staleness-warning>⚠️ Context is ${ageDays}d old.</staleness-warning>`);
    appendContextUpdateHint(lines, updateParams);
    return;
  }

  if (elapsedHours >= 4) {
    const ageHours = Math.floor(elapsedHours);
    lines.push(
      `  <staleness-warning>⚠️ Context is ${ageHours}h old — consider refreshing if stale.</staleness-warning>`
    );
    appendContextUpdateHint(lines, updateParams);
  }
}

function appendLegacyOriginStaleness(
  lines: string[],
  followUpCount: number,
  originCreatedAt: number | null,
  nowMs: number,
  updateParams: ContextUpdateParams
): void {
  if (followUpCount >= 5) {
    lines.push(
      `  <staleness-warning>⚠️ Stale: ${followUpCount} follow-ups since pinned message.</staleness-warning>`
    );
    appendContextUpdateHint(lines, updateParams);
  }

  if (!originCreatedAt) return;

  const ageHours = (nowMs - originCreatedAt) / (1000 * 60 * 60);
  if (ageHours < 24) return;

  const ageDays = Math.floor(ageHours / 24);
  lines.push(`  <staleness-warning>⚠️ Pinned message is ${ageDays}d old.</staleness-warning>`);
  appendContextUpdateHint(lines, updateParams);
}

function isUserOriginMessage(originMessage: { senderRole: string } | null | undefined): boolean {
  return originMessage?.senderRole.toLowerCase() === 'user';
}

/**
 * Append <context> XML section with context read link and staleness warnings.
 */
// fallow-ignore-next-line complexity
export function appendTaskDeliveryContextSection(
  lines: string[],
  params: TaskDeliveryContextSectionParams
): void {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    isEntryPoint,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    nowMs = Date.now(),
  } = params;

  const contextReadLine = `(read if needed) → \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\``;
  const updateParams = { chatroomId, role, cliEnvPrefix, isEntryPoint };

  if (currentContext) {
    appendContextHeader(lines, contextReadLine);
    appendElapsedContextStaleness(lines, currentContext.elapsedHours, updateParams);
    appendContextClose(lines);
    return;
  }

  if (!isUserOriginMessage(originMessage)) return;

  appendContextHeader(lines, contextReadLine);
  appendLegacyOriginStaleness(
    lines,
    followUpCountSinceOrigin ?? 0,
    originMessageCreatedAt ?? null,
    nowMs,
    updateParams
  );
  appendContextClose(lines);
}
