import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import { getEnhancerToPlannerHandoffTemplate } from './enhancer-to-planner';
import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToEnhancerHandoffTemplate } from './planner-to-enhancer';
import { getPlannerToUserReportTemplate } from './planner-to-user';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';

export interface DuoHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  nativeIntegration?: boolean | undefined;
  chatroomId?: string | undefined;
  role?: string | undefined;
  cliEnvPrefix?: string | undefined;
  conversationMode?: ConversationMode | undefined;
}

// Chat-mode entry-point → user: lean direct-response template.
// All other modes and non-user targets keep historical proof-rich templates unchanged.
const DUO_HANDOFF_TEMPLATES: Record<string, (query: DuoHandoffTemplateQuery) => string> = {
  'planner:builder': () => getPlannerToBuilderHandoffTemplate(),
  'planner:enhancer': () => getPlannerToEnhancerHandoffTemplate(),
  'enhancer:planner': () => getEnhancerToPlannerHandoffTemplate(),
  'planner:user': (query) =>
    query.conversationMode === 'chat'
      ? getChatToUserHandoffTemplate()
      : getPlannerToUserReportTemplate({
          chatroomId: query.chatroomId,
          role: query.role,
          cliEnvPrefix: query.cliEnvPrefix,
        }),
  'builder:planner': (query) =>
    getBuilderToPlannerHandoffTemplate({
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    }),
};

export function getDuoHandoffTemplate(query: DuoHandoffTemplateQuery): string | null {
  const getter =
    DUO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.(query) ?? null;
}
