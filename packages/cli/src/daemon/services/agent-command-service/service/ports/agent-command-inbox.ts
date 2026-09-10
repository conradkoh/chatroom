// fallow-ignore-file unused-file unused-type
// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
import type { AgentStopCommand } from '../../domain/entities/agent-command.js';

export interface AgentCommandInbox {
  claimNext(): Promise<AgentStopCommand | null>;
  acknowledge(commandId: string): Promise<void>;
  renew(commandId: string): Promise<void>;
  subscribe(onAvailable: () => void, onError?: (error: unknown) => void): () => void;
}
