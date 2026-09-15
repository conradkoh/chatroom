import { AGENT_TYPES } from '@workspace/backend/src/domain/entities/agent.js';
import { WorkspaceAgentConfigInboxStatus } from '@workspace/backend/src/domain/entities/chatroom-workspace-agent-config-inbox.js';
import { z } from 'zod';

import { api } from '../../../../../api.js';

/**
 * Declared structure of one `chatroomWorkspaceAgentConfigInbox` row. The
 * `AgentConfigInboxEvent` type is inferred from this schema — the wire shape
 * and the static type cannot drift apart. `strictObject` fails parsing on
 * unknown fields so backend additions surface here first, not downstream.
 */
const agentConfigInboxRowSchema = z.strictObject({
  _id: z.string(),
  machineId: z.string(),
  chatroomId: z.string(),
  role: z.string(),
  agentType: z.enum(AGENT_TYPES),
  agentHarness: z.string(),
  model: z.string(),
  workingDir: z.string(),
  status: z.enum(WorkspaceAgentConfigInboxStatus),
  createdAt: z.number(),
});

/**
 * One agent config inbox event as the daemon sees it: the row with `_id`
 * renamed to `eventId`. Rows arrive from the backend query in `createdAt`
 * ascending order — consumers rely on that for supersession ordering.
 */
const agentConfigInboxEventSchema = agentConfigInboxRowSchema.transform(
  ({ _id: eventId, ...row }) => ({ ...row, eventId })
);

export type AgentConfigInboxEvent = z.infer<typeof agentConfigInboxEventSchema>;

/**
 * Parses backend rows into events. Fails early: any row that deviates from
 * the declared structure (missing field, wrong type, unknown field) throws,
 * so a shape change on either side of the boundary surfaces at the adapter —
 * never as undefined leaking into the registry.
 */
export function mapAgentConfigInboxRows(rows: unknown): AgentConfigInboxEvent[] {
  return z.array(agentConfigInboxEventSchema).parse(rows);
}

/**
 * Transport-agnostic backend handle — matches how the task-delivery gateway
 * receives Convex access, keeping this service testable without a client.
 */
type Backend = {
  mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

/** Inbox read side for the configuration service (`api.daemon.agentConfigInbox`). */
export interface AgentConfigGateway {
  listPendingAgentConfigEvents(args: {
    sessionId: string;
    machineId: string;
  }): Promise<readonly AgentConfigInboxEvent[]>;
  /** Returns false when the event was already processed or belongs to another machine. */
  markAgentConfigEventProcessed(args: {
    sessionId: string;
    machineId: string;
    eventId: string;
  }): Promise<boolean>;
}

export function createConvexAgentConfigGateway(backend: Backend): AgentConfigGateway {
  return {
    listPendingAgentConfigEvents: async ({ sessionId, machineId }) => {
      const rows = await backend.query(api.daemon.agentConfigInbox.listPending, {
        sessionId,
        machineId,
      });
      return mapAgentConfigInboxRows(rows);
    },
    markAgentConfigEventProcessed: async ({ sessionId, machineId, eventId }) => {
      const result = (await backend.mutation(api.daemon.agentConfigInbox.markProcessed, {
        sessionId,
        machineId,
        eventId,
      })) as { processed?: boolean };
      return Boolean(result.processed);
    },
  };
}
