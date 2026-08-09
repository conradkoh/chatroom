/**
 * P8 orchestration host — daemon-side mirror type.
 * Matches `services/backend/src/domain/usecase/chatroom/orchestration-host.ts`
 * (no shared package per discovery §3.3).
 */
export type OrchestrationHost = { machineId: string; workingDir: string };
