/**
 * Daemon-wide service contract surface.
 *
 * Composition roots may import concrete factories. All other daemon modules
 * use this façade so service-package internals remain replaceable.
 */
export * from './agent-process-contracts.js';
export {
  createTaskService,
  type TaskService,
  type NativeDeliverySessionHandles,
  type NativeInjectorDeps,
  type NativeInjectorAgentMgr,
  buildNativeInjectionPrompt,
  explainNativeDeliveryBlock,
  isNativeHarness,
  isDeliverableNativeTaskStatus,
  shouldDeliverNativeTask,
  snapshotRequestsNativeColdSession,
  isAgentReadyForNativeDelivery,
  explainAgentReadyForNativeDeliveryBlock,
} from './task-service/index.js';
