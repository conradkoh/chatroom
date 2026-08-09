import { api } from '../../../api.js';
import {
  receiveUserMessage,
  type ReceiveUserMessageDeps,
} from '../../application/use-cases/messages/receive-user-message.js';
import type { InboundEvent } from '../entities/inbound-event.js';
import type { OutboundEvent } from '../entities/outbound-event.js';

export type OrchestrationIngressInboundEvent = Extract<
  InboundEvent,
  { type: 'orchestration.ingress' }
>;

export type HandleOrchestrationIngressInboundDeps = ReceiveUserMessageDeps & {
  sessionId: string;
  appendEvent: (event: OutboundEvent) => void;
  mutate: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

export async function handleOrchestrationIngressInbound(
  deps: HandleOrchestrationIngressInboundDeps,
  event: OrchestrationIngressInboundEvent
): Promise<void> {
  const result = receiveUserMessage(deps, {
    chatroomId: event.chatroomId,
    content: event.content,
    targetRole: event.targetRole,
    ingressId: event.ingressId,
    attachedTaskIds: event.attachedTaskIds,
    attachedBacklogItemIds: event.attachedBacklogItemIds,
    attachedMessageIds: event.attachedMessageIds,
    attachedSnippets: event.attachedSnippets,
    sourcePlatform: event.sourcePlatform,
    scheduledPromptId: event.scheduledPromptId,
    plannerEnhancerEnabled: event.plannerEnhancerEnabled,
  });

  if (result.queued) {
    await deps.mutate(api.orchestration.enqueueIngressToMessageQueue, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      ingressId: event.ingressId,
      chatroomId: event.chatroomId,
      content: event.content,
      targetRole: event.targetRole,
      attachedTaskIds: event.attachedTaskIds,
      attachedBacklogItemIds: event.attachedBacklogItemIds,
      attachedMessageIds: event.attachedMessageIds,
      attachedSnippets: event.attachedSnippets,
      sourcePlatform: event.sourcePlatform,
      scheduledPromptId: event.scheduledPromptId,
      plannerEnhancerEnabled: event.plannerEnhancerEnabled,
    });
  } else if (result.outboundEvent) {
    deps.appendEvent(result.outboundEvent);
  }

  await deps.mutate(api.orchestration.ackOrchestrationIngress, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    ingressId: event.ingressId,
  });
}
