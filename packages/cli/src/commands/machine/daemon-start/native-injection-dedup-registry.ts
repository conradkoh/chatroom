import { NativeInjectionDedup } from './native-task-injector-logic.js';

let dedup: NativeInjectionDedup | undefined;
const injectedTaskSlotsByDedup = new WeakMap<
  NativeInjectionDedup,
  Map<string, { chatroomId: string; role: string }>
>();

function slotsFor(
  dedupInstance: NativeInjectionDedup
): Map<string, { chatroomId: string; role: string }> {
  let slots = injectedTaskSlotsByDedup.get(dedupInstance);
  if (!slots) {
    slots = new Map();
    injectedTaskSlotsByDedup.set(dedupInstance, slots);
  }
  return slots;
}

/** Shared dedup instance used by the task monitor for the daemon lifetime. */
export function getNativeInjectionDedup(): NativeInjectionDedup {
  dedup ??= new NativeInjectionDedup();
  return dedup;
}

export function markNativeTaskInjected(
  dedupInstance: NativeInjectionDedup,
  taskId: string,
  slot: { chatroomId: string; role: string }
): void {
  dedupInstance.markInjected(taskId);
  slotsFor(dedupInstance).set(taskId, slot);
}

export function clearNativeTaskInjection(
  dedupInstance: NativeInjectionDedup,
  taskId: string
): void {
  dedupInstance.clear(taskId);
  slotsFor(dedupInstance).delete(taskId);
}

/** Allow native task re-injection after a cursor-sdk run-error cold restart. */
export function clearNativeInjectionDedupForAgent(chatroomId: string, role: string): void {
  const dedupInstance = getNativeInjectionDedup();
  for (const [taskId, slot] of slotsFor(dedupInstance)) {
    if (slot.chatroomId === chatroomId && slot.role === role) {
      clearNativeTaskInjection(dedupInstance, taskId);
    }
  }
}
