// fallow-ignore-file unused-file
// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
export * from './domain/entities/agent-command.js';
export * from './domain/entities/agent-fact.js';
export * from './service/agent-command-service.js';
export * from './service/ports/agent-command-process-manager.js';
export * from './service/ports/agent-fact-sink.js';
export * from './service/ports/agent-command-inbox.js';
export * from './service/agent-command-inbox-consumer.js';
export {
  createDaemonAgentCommandService,
  type AgentCommandServiceCompositionDependencies,
} from './composition/agent-command-service.js';
export {
  startDaemonAgentCommandRuntime,
  type AgentCommandRuntimeDependencies,
} from './composition/agent-command-runtime.js';
