import type { DatabaseSync } from 'node:sqlite';
import type { OutboundEvent } from '../entities/outbound-event.js';
import type { OrchestrationTaskReadyEvent } from './execute-handoff.js';
import { ingestUserMessage } from '../../application/use-cases/messages/ingest-user-message.js';

export type UserMessageInboundEvent = { chatroomId: string; messageId: string; content?: string; senderRole?: string };
export type HandleUserMessageInboundDeps = {
  db: DatabaseSync; machineId: string; sessionId: string; appendEvent: (event: OutboundEvent) => void;
  emitOrchestrationEvent: (event: OrchestrationTaskReadyEvent & { source: 'user-message' }) => void;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  getEntryPointRole: (chatroomId: string) => Promise<string>;
  getAgentHarness: (chatroomId: string, role: string) => Promise<string | undefined>;
};
export async function handleUserMessageInbound(deps: HandleUserMessageInboundDeps, event: UserMessageInboundEvent): Promise<void> {
  const content = event.content;
  if (!content || (event.senderRole && event.senderRole !== 'user')) return;
  await ingestUserMessage(deps, { chatroomId: event.chatroomId, messageId: event.messageId, content, senderRole: 'user', entryPointRole: await deps.getEntryPointRole(event.chatroomId) });
}
