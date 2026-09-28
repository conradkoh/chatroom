/**
 * Shared guidance for communicating between team roles.
 */
export function getInterRoleHandoffRule(): string {
  return '- **To communicate with another team role** → Use `chatroom handoff` to that role, even for a short test or status message. Do not use `chatroom message(s) send`: those are user-ingress commands that persist `senderRole=user` and `type=message`.';
}
