// fallow-ignore-file unused-export unused-type

/**
 * Public boundary for task lifecycle and native task delivery operations.
 *
 * Callers should import task injection capabilities from this module rather
 * than reaching into the service implementation or delivery entrypoints.
 */
export {
  runNativeInjectionEffect,
  type NativeDeliverySessionHandles,
  type NativeInjectorAgentMgr,
  type NativeInjectorDeps,
} from './service/native-task-injector.js';
export {
  buildNativeInjectionPrompt,
  explainNativeDeliveryBlock,
  isNativeHarness,
  isDeliverableNativeTaskStatus,
  shouldDeliverNativeTask,
  type NativeDeliveryReadinessOptions,
} from './domain/usecase/native-task-injector-logic.js';
export {
  isAgentReadyForNativeDelivery,
  explainAgentReadyForNativeDeliveryBlock,
} from './domain/usecase/native-ready-invariant.js';
export {
  snapshotRequestsNativeColdSession,
  isNativeColdSessionDeliveryOwnedSpawn,
  explainColdSessionDeliveryBlock,
} from './domain/usecase/native-cold-session-delivery.js';
export {
  createTaskService,
  type TaskService,
  type TaskServiceCompositionDependencies,
  type TaskServiceNotification,
  type WorkspaceTaskInboxEvent,
} from './service/task-service.js';
export { createConvexNativeTaskDeliveryGateway } from './infrastructure/adapters/convex-native-task-delivery-gateway.js';
export { createDaemonAuditPort } from './infrastructure/adapters/daemon-audit-port.js';
export {
  resetRoleDeliveryState,
  type NativeDeliveryDelivered,
  type NativeDeliveryExecution,
  type NativeDeliveryExecutors,
  type NativeTaskDeliverySessionDeps,
  NativeTaskDeliveryCoordinator,
} from './service/native-delivery/native-task-delivery-coordinator.js';
