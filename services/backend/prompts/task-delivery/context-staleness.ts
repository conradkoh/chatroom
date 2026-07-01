/**
 * Shared context header + staleness warnings for task delivery (CLI and native).
 */

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
  lines.push(
    `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
  );
}

function appendContextHeader(lines: string[], contextReadLine: string): void {
  lines.push('');
  lines.push('## Context');
  lines.push(contextReadLine);
}

function appendElapsedContextStaleness(
  lines: string[],
  elapsedHours: number,
  updateParams: ContextUpdateParams
): void {
  if (elapsedHours >= 24) {
    const ageDays = Math.floor(elapsedHours / 24);
    lines.push('');
    lines.push(`⚠️ Context is ${ageDays}d old.`);
    appendContextUpdateHint(lines, updateParams);
    return;
  }

  if (elapsedHours >= 4) {
    const ageHours = Math.floor(elapsedHours);
    lines.push('');
    lines.push(`⚠️ Context is ${ageHours}h old — consider refreshing if stale.`);
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
    lines.push('');
    lines.push(`⚠️ Stale: ${followUpCount} follow-ups since pinned message.`);
    appendContextUpdateHint(lines, updateParams);
  }

  if (!originCreatedAt) return;

  const ageHours = (nowMs - originCreatedAt) / (1000 * 60 * 60);
  if (ageHours < 24) return;

  const ageDays = Math.floor(ageHours / 24);
  lines.push('');
  lines.push(`⚠️ Pinned message is ${ageDays}d old.`);
  appendContextUpdateHint(lines, updateParams);
}

function isUserOriginMessage(originMessage: { senderRole: string } | null | undefined): boolean {
  return originMessage?.senderRole.toLowerCase() === 'user';
}

/**
 * Append ## Context header, context read link, and staleness warnings when applicable.
 * Matches CLI get-next-task task delivery behavior.
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
}
