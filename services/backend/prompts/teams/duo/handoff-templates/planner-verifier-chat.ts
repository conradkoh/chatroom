/**
 * Key: `duo:planner->verifier@chat`.
 * Duo planner → verifier chat-bucket body. Re-exports the code getter so both modes render the same body.
 */
export { getPlannerVerifierCodeTemplate as getPlannerVerifierChatTemplate } from './planner-verifier-code';
