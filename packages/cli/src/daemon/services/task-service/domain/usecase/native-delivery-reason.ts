/**
 * Stable, machine-comparable reasons for why native task delivery is blocked.
 *
 * Returned by the readiness explainers (`explainNativeDeliveryBlock`,
 * `explainAgentReadyForNativeDeliveryBlock`, `explainColdSessionDeliveryBlock`)
 * and consumed by `decideNextDelivery` — no string parsing anywhere.
 */
export type DeliveryBlockReason =
  | 'not_native_harness'
  | 'agent_config_missing'
  | 'task_status_not_deliverable'
  | 'acknowledged_wrong_role'
  | 'chatroom_stop_scope_active'
  | 'slot_missing'
  | 'slot_not_running'
  | 'slot_pid_missing'
  | 'harness_session_missing'
  | 'turn_not_idle'
  | 'slot_spawning'
  | 'slot_stopping';
