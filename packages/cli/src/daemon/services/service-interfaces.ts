// fallow-ignore-file unused-export unused-type
/**
 * Daemon-wide service contract surface.
 *
 * Composition roots may import concrete factories. All other daemon modules
 * use this façade so service-package internals remain replaceable.
 *
 * Re-exports below are intentional public API (service-package barrels), so
 * unused-export findings are suppressed at the file level — matching the
 * convention in task-service/index.ts.
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
export {
  createOperationalObservabilityService,
  DEFAULT_OBSERVABILITY_ROLE_LIMIT,
  DEFAULT_OBSERVABILITY_SCOPE_LIMIT,
  OPERATIONAL_OBSERVABILITY_SCHEMA_VERSION,
  type OperationalObservabilityScopeSnapshot,
  type OperationalObservabilityService,
  type OperationalObservabilitySink,
  type OperationalObservabilitySnapshot,
} from './observability-service/index.js';
