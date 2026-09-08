/**
 * Public boundary for agent-process lifecycle management.
 *
 * Callers should import from this module rather than reaching into the
 * service implementation or its infrastructure adapters.
 */
export * from './service/index.js';
export * from './infrastructure/agent-process-manager.js';
export * from './infrastructure/execute-stop-targets-adapter.js';
export * from './infrastructure/harness-activity-emitter.js';
export * from './infrastructure/stop-agent-confirmed-adapter.js';
export * from './infrastructure/components/command-notifier/index.js';
