import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { getSoloToUserReportTemplate } from './solo-to-user';
import {
  getEnhancerToEntryPointHandoffTemplate,
  getEntryPointToEnhancerHandoffTemplate,
} from '../../../enhancer/handoff-templates.js';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';

export interface SoloHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  chatroomId?: string | undefined;
  role?: string | undefined;
  cliEnvPrefix?: string | undefined;
  conversationMode?: ConversationMode | undefined;
}

// Chat-mode entry-point → user: lean direct-response template.
// All other modes and non-user targets keep historical proof-rich templates unchanged.
const SOLO_HANDOFF_TEMPLATES: Record<string, (query: SoloHandoffTemplateQuery) => string> = {
  'solo:enhancer': () => getEntryPointToEnhancerHandoffTemplate('solo'),
  'enhancer:solo': () => getEnhancerToEntryPointHandoffTemplate('solo'),
  'solo:user': (query) =>
    query.conversationMode === 'chat'
      ? getChatToUserHandoffTemplate()
      : getSoloToUserReportTemplate({
          chatroomId: query.chatroomId,
          role: query.role,
          cliEnvPrefix: query.cliEnvPrefix,
        }),
};

export function getSoloHandoffTemplate(query: SoloHandoffTemplateQuery): string | null {
  const getter =
    SOLO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.(query) ?? null;
}
