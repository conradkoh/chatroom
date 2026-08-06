export function logNativeDeliveryPrimary(role: string, chatroomId: string): void {
  console.log(`[NativeDelivery:primary] turn idle ${role}@${chatroomId} — trying inject`);
}

export function logNativeDeliveryFallback(
  reason: 'signal-presence' | 'periodic-reconcile' | 'native-light-nudge',
  role: string,
  chatroomId: string,
  taskId?: string
): void {
  const taskSuffix = taskId ? ` task ${taskId}` : '';
  console.log(`[NativeDelivery:fallback] ${reason} ${role}@${chatroomId}${taskSuffix} — reconcile`);
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

export function logNativeDeliveryNoTasks(role: string, chatroomId: string): void {
  console.log(`[NativeDelivery:skip] ${role}@${chatroomId} — no pending tasks for role`);
}
