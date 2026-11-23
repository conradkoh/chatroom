import type { BuiltinTeamRole } from '@workspace/shared/domain/agent-role';

import type { RoleIdentity } from '../../../types/role-identity';

/**
 * Solo team role identities. Exhaustive over the solo roles: a missing or extra
 * key fails to compile in this file only.
 */
export const SOLO_ROLE_IDENTITY: { readonly [R in BuiltinTeamRole<'solo'>]: RoleIdentity } = {
  solo: {
    title: 'Solo',
    description:
      'You are the autonomous agent responsible for both planning and executing tasks independently.',
  },
  architect: {
    title: 'Architect',
    description:
      'You are the architect responsible for producing one complete implementation design for the request; you are not an implementer.',
  },
  'product-manager': {
    title: 'Product Manager',
    description:
      'You are the product manager responsible for producing one product specification (user stories with acceptance criteria and an explicit in-scope and out-of-scope decision) that is feature complete and consistent with existing app behavior; you are not an implementer.',
  },
  triage: {
    title: 'Triage Agent',
    description:
      'You are the triage agent responsible for thoroughly investigating reported bugs and returning an evidence-backed diagnosis; you do not implement fixes.',
  },
  'uiux-engineer': {
    title: 'UI/UX Engineer',
    description:
      'You are the UI/UX engineer responsible for producing one complete interface and experience design for the request; you are not an implementer.',
  },
  verifier: {
    title: 'Verifier',
    description:
      "You are the verifier responsible for judging, from chatroom logs only, whether the user's last message was achieved; you do not implement, build, or edit code, and you run only the tests the user explicitly asked for.",
  },
};
