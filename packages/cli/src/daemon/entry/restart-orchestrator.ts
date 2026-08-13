/**
 * Restart orchestrator — thin wrapper delegating to the P4 local state-machine
 * use case. Kept for import-compat (`runRestartOrchestrator`) and the
 * P2-cutover db setter (`setRestartOrchestratorDb`).
 */

export {
  orchestrateRestart as runRestartOrchestrator,
  setRestartOrchestratorDb,
} from '../application/use-cases/restart/orchestrate-restart.js';
