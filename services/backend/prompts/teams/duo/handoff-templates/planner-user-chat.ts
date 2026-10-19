/**
 * Key: `duo:planner->user@chat`.
 * Chat-mode planner → user response. The body is shared with every team's chat
 * replies, so it is re-exported rather than copied.
 */
export { getChatToUserHandoffTemplate as getPlannerUserChatTemplate } from '../../../utils/chat-handoff-template';
