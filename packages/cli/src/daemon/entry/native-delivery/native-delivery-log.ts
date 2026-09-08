export function logNativeDeliveryPrimary(role: string, chatroomId: string): void {
  console.log(`[NativeDelivery:primary] turn idle ${role}@${chatroomId} — trying inject`);
}

type NativeDeliveryPass =
  | 'inbox-signal'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'operational-status'
  | 'restart'
  | 'agent-started';

/** Logs an event-driven delivery pass; this is not a fallback/recovery path. */
export function logNativeDeliveryTrigger(
  source: Exclude<NativeDeliveryPass, 'periodic-reconcile'>,
  role: string,
  chatroomId: string,
  taskId?: string
): void {
  const taskSuffix = taskId ? ` task ${taskId}` : '';
  console.log(`[NativeDelivery:trigger] source=${source} ${role}@${chatroomId}${taskSuffix}`);
}

/** Logs the periodic recovery pass separately from normal delivery triggers. */
export function logNativeDeliveryFallback(
  reason: 'periodic-reconcile',
  role: string,
  chatroomId: string,
  taskId?: string
): void {
  const taskSuffix = taskId ? ` task ${taskId}` : '';
  console.log(
    `[NativeDelivery:fallback] source=${reason} ${role}@${chatroomId}${taskSuffix} — periodic recovery pass`
  );
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

// fallow-ignore-next-line unused-export
export function logNativeDeliveryNoTasks(role: string, chatroomId: string): void {
  console.log(`[NativeDelivery:skip] ${role}@${chatroomId} — no pending tasks for role`);
}
