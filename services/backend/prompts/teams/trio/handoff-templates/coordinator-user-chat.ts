/**
 * Key: `trio:coordinator->user@chat`.
 * Chat-mode coordinator → user response. The body is shared with every team's chat
 * replies, so it is re-exported rather than copied.
 */
export { getChatToUserHandoffTemplate as getCoordinatorUserChatTemplate } from '../../../utils/chat-handoff-template';
