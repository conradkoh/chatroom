/**
 * Repo-wide cross-role script audit (test-only helper).
 *
 * Renders every preset team's role prompts and handoff templates, then checks
 * the cross-role promises they make: an advertised handoff target is a declared
 * contract target, the delegator's template carries the context the recipient's
 * brief expects, and every structured handoff artifact named by the sender is
 * addressed to the receiver.
 *
 * Test-only: `cross-role-script-audit.test.ts` imports this module; no
 * production prompt path imports it.
 */

import {
  CONVERSATION_MODES,
  type ConversationMode,
} from '@workspace/shared/domain/conversation-mode';
import {
  TEAM_PRESET_IDS,
  TEAM_PRESETS,
  type TeamHandoffGraphPolicy,
  type TeamPresetId,
} from '@workspace/shared/domain/team-presets';

import { pairCarriesGroundingReference } from '../cli/grounding/reference';
import { listHandoffTemplatePairs, renderHandoffTemplate } from '../cli/handoff-templates';
import { listDuoRoleHandoffContracts } from './duo/handoff-templates';
import {
  CHARACTERISATION_CHATROOM_ID,
  renderInitSystemPrompt,
} from './role-prompt-characterisation';
import { listSoloRoleHandoffContracts } from './solo/handoff-templates';
import { listTrioRoleHandoffContracts } from './trio/handoff-templates';
import type { RoleHandoffContract } from '../cli/handoff-templates/contracts';

const USER_ROLE = 'user';
const GROUNDING_REFERENCE_HEADING = '### Grounding reference';
const HANDOFF_OPTIONS_PATTERN = /^### Handoff Options\nAvailable targets: (.+)$/m;

/**
 * The context each receiving role's own guidance says it recovers from a
 * handoff. Each inner array is an AND-set of literal tokens; the outer array is
 * an OR of alternatives, because one role can receive more than one kind of
 * brief. A recipient with no entry makes the audit fail.
 */
export const RECIPIENT_CONTEXT_EXPECTATIONS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  architect: [['authoritative request', 'relevant constraints']],
  builder: [['## Files to implement', '## Test seams', '## Verification flags']],
  'game-asset-designer': [
    ['## Lighting contract', '## Budgets and conventions', '## Style reference'],
  ],
  'product-manager': [['authoritative request', 'the problem it solves']],
  'prompt-engineer': [['agent behavior the prompt must produce', 'the roles and teams affected']],
  researcher: [['authoritative request', 'research questions']],
  reviewer: [['review target and the review focus']],
  triage: [['observed and expected behavior', 'reproduction details']],
  'uiux-engineer': [['authoritative request', 'relevant constraints']],
  verifier: [
    [
      '## Round',
      '## Mode',
      '## Deliverable type',
      '## User message id',
      '## Log message ids',
      '## Claimed outcome',
      '## Evidence pointers',
      '## Known gaps',
    ],
  ],
  specifier: [
    [
      '## Summary',
      '## Goal',
      '## User requirements',
      '## Inputs from specialists',
      '## Scope',
      '## Plan phases',
      '## Prior deliveries',
      '## Rework findings',
    ],
    ['## Summary', '## Proof of Completion'],
    ['Plan phases:'],
  ],
  coordinator: [['## Summary'], ['## Verdict'], ['Plan phases:']],
  planner: [['## Summary'], ['## Verdict'], ['Plan phases:']],
  solo: [['## Summary'], ['## Verdict'], ['Plan phases:']],
};

export interface RenderedRolePrompt {
  readonly teamId: string;
  readonly handoffGraph: TeamHandoffGraphPolicy;
  readonly role: string;
  readonly teamRoles: readonly string[];
  readonly advertisedTargets: readonly string[];
  readonly contractTargets: readonly string[];
}

export interface RenderedHandoffTemplate {
  readonly teamId: string;
  readonly fromRole: string;
  readonly toRole: string;
  readonly mode: ConversationMode;
  readonly text: string;
}

export type CrossRoleViolationKind =
  | 'undeclared-target'
  | 'unadvertised-target'
  | 'missing-template'
  | 'missing-expectation'
  | 'missing-context'
  | 'return-path'
  | 'grounding-mismatch';

export interface CrossRoleViolation {
  readonly kind: CrossRoleViolationKind;
  /** `teamId: fromRole → toRole`, or `teamId: role → target` for prompt targets. */
  readonly pair: string;
  readonly message: string;
}

export interface CrossRoleAuditInput {
  readonly rolePrompts: readonly RenderedRolePrompt[];
  readonly templates: readonly RenderedHandoffTemplate[];
  readonly recipientExpectations: Readonly<Record<string, readonly (readonly string[])[]>>;
  readonly carriesGroundingReference: (pair: {
    teamId: string;
    fromRole: string;
    toRole: string;
  }) => boolean;
}

const CONTRACT_LISTS: Record<TeamPresetId, () => readonly RoleHandoffContract[]> = {
  duo: listDuoRoleHandoffContracts,
  solo: listSoloRoleHandoffContracts,
  trio: listTrioRoleHandoffContracts,
};

function parseAdvertisedTargets(label: string, prompt: string): readonly string[] {
  const match = HANDOFF_OPTIONS_PATTERN.exec(prompt);
  if (!match?.[1]) {
    throw new Error(`${label}: rendered prompt has no "Handoff Options" section`);
  }
  return match[1]
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target !== '');
}

function collectRolePrompts(teamId: TeamPresetId): RenderedRolePrompt[] {
  const preset = TEAM_PRESETS[teamId];
  const teamRoles = [...preset.roles];
  const contracts = CONTRACT_LISTS[teamId]();

  return teamRoles.map((role) => {
    const contract = contracts.find((candidate) => candidate.role === role);
    if (!contract) {
      throw new Error(`${teamId}: no handoff contract for role "${role}"`);
    }
    const prompt = renderInitSystemPrompt({ teamId, teamName: preset.name, teamRoles }, role);
    return {
      teamId,
      handoffGraph: preset.handoffGraph,
      role,
      teamRoles,
      advertisedTargets: parseAdvertisedTargets(`${teamId}: ${role}`, prompt),
      contractTargets: contract.returnsTo,
    };
  });
}

function collectTemplates(teamId: TeamPresetId): RenderedHandoffTemplate[] {
  return listHandoffTemplatePairs(teamId).flatMap((pair) =>
    CONVERSATION_MODES.map((mode) => ({
      teamId,
      fromRole: pair.fromRole,
      toRole: pair.toRole,
      mode,
      text:
        renderHandoffTemplate(pair, {
          chatroomId: CHARACTERISATION_CHATROOM_ID,
          cliEnvPrefix: 'CHATROOM',
          conversationMode: mode,
        }) ?? '',
    }))
  );
}

/** Renders every preset team's role prompts and handoff templates into audit input. */
export function collectCrossRoleAuditInput(): CrossRoleAuditInput {
  return {
    rolePrompts: TEAM_PRESET_IDS.flatMap(collectRolePrompts),
    templates: TEAM_PRESET_IDS.flatMap(collectTemplates),
    recipientExpectations: RECIPIENT_CONTEXT_EXPECTATIONS,
    carriesGroundingReference: pairCarriesGroundingReference,
  };
}

/**
 * Audits the rendered cross-role script. Every violation names the mismatched
 * role pair in `pair` and repeats it at the start of `message`.
 */
export function auditCrossRoleScript(input: CrossRoleAuditInput): CrossRoleViolation[] {
  return [
    ...input.rolePrompts.flatMap(auditRolePrompt),
    ...input.templates.flatMap((template) => auditHandoffTemplate(template, input)),
  ];
}

/** Prompt-side promises: advertised targets and contract targets agree. */
function auditRolePrompt(prompt: RenderedRolePrompt): CrossRoleViolation[] {
  return [...auditAdvertisedTargets(prompt), ...auditContractTargets(prompt)];
}

function auditAdvertisedTargets(prompt: RenderedRolePrompt): CrossRoleViolation[] {
  const contractTargets = new Set(prompt.contractTargets);

  return prompt.advertisedTargets.flatMap((target): CrossRoleViolation[] => {
    if (target === USER_ROLE) return [];
    const pair = `${prompt.teamId}: ${prompt.role} → ${target}`;

    if (!prompt.teamRoles.includes(target)) {
      return [
        {
          kind: 'undeclared-target',
          pair,
          message: `${pair} — the ${prompt.role} prompt advertises "${target}", which is not a member of the ${prompt.teamId} team`,
        },
      ];
    }
    if (prompt.handoffGraph === 'enforced' && !contractTargets.has(target)) {
      return [
        {
          kind: 'undeclared-target',
          pair,
          message: `${pair} — the ${prompt.role} prompt advertises "${target}", which is not a ${prompt.teamId} contract target (declared: ${[...contractTargets].join(', ')})`,
        },
      ];
    }
    return [];
  });
}

function auditContractTargets(prompt: RenderedRolePrompt): CrossRoleViolation[] {
  const advertised = new Set(prompt.advertisedTargets);

  return prompt.contractTargets
    .filter((target) => target !== USER_ROLE && !advertised.has(target))
    .map((target) => {
      const pair = `${prompt.teamId}: ${prompt.role} → ${target}`;
      return {
        kind: 'unadvertised-target',
        pair,
        message: `${pair} — the ${prompt.teamId} contract declares "${target}" as a target for "${prompt.role}", but its prompt does not advertise it`,
      };
    });
}

/** Template-side promises: the sender's brief supplies what the recipient expects. */
function auditHandoffTemplate(
  template: RenderedHandoffTemplate,
  input: CrossRoleAuditInput
): CrossRoleViolation[] {
  if (template.toRole === USER_ROLE) return [];
  const pair = `${template.teamId}: ${template.fromRole} → ${template.toRole}`;

  if (template.text.trim() === '') {
    return [
      {
        kind: 'missing-template',
        pair,
        message: `${pair} — no handoff template renders for this pair`,
      },
    ];
  }
  return [
    ...auditRecipientContext(template, pair, input.recipientExpectations),
    ...auditReturnPaths(template, pair),
    ...auditGroundingReference(template, pair, input.carriesGroundingReference),
  ];
}

function auditRecipientContext(
  template: RenderedHandoffTemplate,
  pair: string,
  expectations: CrossRoleAuditInput['recipientExpectations']
): CrossRoleViolation[] {
  const alternatives = expectations[template.toRole];
  if (!alternatives) {
    return [
      {
        kind: 'missing-expectation',
        pair,
        message: `${pair} — no recipient context expectation is declared for "${template.toRole}"`,
      },
    ];
  }
  const satisfied = alternatives.some((tokens) =>
    tokens.every((token) => template.text.includes(token))
  );
  if (satisfied) return [];

  return [
    {
      kind: 'missing-context',
      pair,
      message: `${pair} — the "${template.fromRole}" template does not supply the context "${template.toRole}" expects (${alternatives
        .map((tokens) => tokens.join(' + '))
        .join(' OR ')})`,
    },
  ];
}

/** Every `--next-role` the template names must be the receiver or the sender (return path). */
function auditReturnPaths(template: RenderedHandoffTemplate, pair: string): CrossRoleViolation[] {
  return [...template.text.matchAll(/--next-role="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (target): target is string =>
        target !== undefined && target !== template.toRole && target !== template.fromRole
    )
    .map((target) => ({
      kind: 'return-path',
      pair,
      message: `${pair} — the template names --next-role="${target}", which is neither the receiver "${template.toRole}" nor the sender "${template.fromRole}"`,
    }));
}

function auditGroundingReference(
  template: RenderedHandoffTemplate,
  pair: string,
  carriesGroundingReference: CrossRoleAuditInput['carriesGroundingReference']
): CrossRoleViolation[] {
  const carries = template.text.includes(GROUNDING_REFERENCE_HEADING);
  const mustCarry = carriesGroundingReference({
    teamId: template.teamId,
    fromRole: template.fromRole,
    toRole: template.toRole,
  });
  if (carries !== mustCarry) {
    return [
      {
        kind: 'grounding-mismatch',
        pair,
        message: `${pair} — the ${template.mode} template ${carries ? 'carries' : 'does not carry'} the grounding reference it ${mustCarry ? 'must' : 'must not'} carry`,
      },
    ];
  }
  if (carries && !template.text.includes(`--role="${template.toRole}"`)) {
    return [
      {
        kind: 'grounding-mismatch',
        pair,
        message: `${pair} — the grounding reference is not addressed to the receiver "${template.toRole}"`,
      },
    ];
  }
  return [];
}
