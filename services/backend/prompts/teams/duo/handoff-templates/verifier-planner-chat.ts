/**
 * Key: `duo:verifier->planner@chat`.
 * Duo verifier → planner chat-bucket body. Re-exports the code getter so both modes render the same body.
 */
export { getVerifierPlannerCodeTemplate as getVerifierPlannerChatTemplate } from './verifier-planner-code';
