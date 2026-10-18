/**
 * Key: `duo:triage->planner@chat`.
 * Duo triage → planner chat-bucket body. Re-exports the code getter so both modes render the same body.
 */
export { getTriagePlannerCodeTemplate as getTriagePlannerChatTemplate } from './triage-planner-code';
