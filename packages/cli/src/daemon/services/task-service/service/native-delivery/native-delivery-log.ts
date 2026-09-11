type NativeDeliveryPass =
  'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'restart' | 'agent-started';
type ExtendedNativeDeliveryPass =
  NativeDeliveryPass | 'task-signal' | 'agent-session-lost' | 'turn-ended' | 'restart-completed';

export function logNativeDeliveryDecision(
  source: ExtendedNativeDeliveryPass,
  role: string,
  chatroomId: string,
  decision: string,
  taskId?: string,
  details?: {
    reason?: string;
    attemptId?: string;
    slotState?: string;
    nativeTurnPhase?: string;
    harnessSessionPresent?: boolean;
  }
): void {
  const taskSuffix = taskId ? ` task=${taskId}` : '';
  const detailSuffix = details
    ? Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
    : '';
  console.log(
    `[NativeDelivery:decision] source=${source} role=${role} chatroom=${chatroomId}${taskSuffix} decision=${decision}${detailSuffix ? ` ${detailSuffix}` : ''}`
  );
}

/** Logs an event-driven delivery pass; this is not a fallback/recovery path. */
export function logNativeDeliveryTrigger(
  source: ExtendedNativeDeliveryPass,
  role: string,
  chatroomId: string,
  taskId?: string
): void {
  const taskSuffix = taskId ? ` task ${taskId}` : '';
  console.log(`[NativeDelivery:trigger] source=${source} ${role}@${chatroomId}${taskSuffix}`);
}

export function logNativeDeliverySkip(
  role: string,
  chatroomId: string,
  taskId: string,
  reason: string
): void {
  console.log(`[NativeDelivery:skip] ${role}@${chatroomId} task ${taskId} — ${reason}`);
}

export function logNativeDeliveryMutexSkip(role: string, chatroomId: string, taskId: string): void {
  console.log(
    `[NativeDelivery:skip] ${role}@${chatroomId} task ${taskId} — delivery_mutex_busy (another inject in flight)`
  );
}

export function logNativeDeliveryInjecting(role: string, chatroomId: string, taskId: string): void {
  console.log(`[NativeDelivery:inject] ${role}@${chatroomId} task ${taskId} — starting injection`);
}
