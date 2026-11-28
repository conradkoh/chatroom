/**
 * Repo-wide cross-role script audit (test-only helper).
 *
 * Renders every preset team's role prompts and handoff templates, then checks
 * the cross-role promises they make: an advertised handoff target equals the
 * runtime-available target set, the delegator's template carries the context
 * the recipient's own guidance says it expects, and every structured handoff
 * artifact named by the sender is addressed to the receiver.
 *
 * Test-only: `cross-role-script-audit.test.ts` imports this module; no
 * production prompt path imports it.
 */

import { CHATROOM_ROLE_USER } from '@workspace/shared/domain/chatroom-role';
import {
  CONVERSATION_MODES,
  type ConversationMode,
} from '@workspace/shared/domain/conversation-mode';
import {
  TEAM_PRESET_IDS,
  TEAM_PRESETS,
  type TeamPresetId,
} from '@workspace/shared/domain/team-presets';

import {
  CHARACTERISATION_CHATROOM_ID,
  renderInitSystemPrompt,
} from './role-prompt-characterisation';
import { buildAvailableHandoffRoles } from '../../convex/lib/handoffRoles';
import {
  GROUNDING_REFERENCE_HEADING,
  type GroundingReferencePair,
} from '../cli/grounding/reference';
import { listHandoffTemplatePairs, renderHandoffTemplate } from '../cli/handoff-templates';

const HANDOFF_OPTIONS_PATTERN = /^### Handoff Options\nAvailable targets: (.+)$/m;

/** Report sections each entry point expects from each sender. */
const REPORT_CONTEXT_BY_SENDER = {
  architect: ['## Summary', '## Requirements (acceptance criteria)', '## Shared contracts'],
  builder: ['## Summary', '## Proof of Completion', '## Code Change Verification'],
  'game-asset-designer': ['## Summary', '## Asset manifest', '## Quality checklist results'],
  'product-manager': ['## Summary', '## In scope', '## Out of scope'],
  'prompt-engineer': ['## Summary', '## Proposed text', '## Acceptance criteria'],
  researcher: ['## Summary', '## Research questions', '## Answers'],
  reviewer: ['## Summary', '## Review scope', '## Issues', '## Not reviewed'],
  // Chat-mode report has no headings; both modes carry the status line and Plan phases.
  specifier: ['delivered | partial | blocked', 'Plan phases'],
  triage: ['## Summary', '## Reported behavior', '## Root cause'],
  'uiux-engineer': [
    '## Summary',
    '## Screens, Flows, and Layouts',
    '## Requirements (acceptance criteria)',
  ],
  verifier: ['## Verdict', '## Objective', '## Requirements', '## Evidence'],
} as const satisfies Record<string, readonly string[]>;

/**
 * What each recipient expects from a brief addressed to it.
 *
 * `requiredBySender[sender]` is an AND-set of literal tokens; `'*'` applies to
 * every sender. Every set carries at least two substantive tokens, so no
 * recipient passes on `## Summary` alone.
 *
 * `guidanceAnchors` are literal phrases from the recipient's own rendered
 * guidance; the audit checks them so a stale table fails. Entry points that
 * only receive reports do not enumerate their inputs, so they pin the report
 * contract with `requiredBySender` instead.
 */
export interface RecipientContextExpectation {
  readonly guidanceAnchors: readonly string[];
  readonly requiredBySender: Readonly<Record<string, readonly string[]>>;
}

export const RECIPIENT_CONTEXT_EXPECTATIONS: Readonly<Record<string, RecipientContextExpectation>> =
  {
    architect: {
      guidanceAnchors: [
        'authoritative user request',
        'relevant chatroom history',
        'constrain the change',
      ],
      requiredBySender: { '*': ['authoritative request', 'relevant constraints'] },
    },
    builder: {
      guidanceAnchors: ['## Verification flags'],
      requiredBySender: {
        '*': ['## Files to implement', '## Test seams', '## Verification flags'],
      },
    },
    'game-asset-designer': {
      guidanceAnchors: ['## Lighting contract', 'Style reference', 'budgets'],
      requiredBySender: {
        '*': ['## Lighting contract', '## Budgets and conventions', '## Style reference'],
      },
    },
    'product-manager': {
      guidanceAnchors: ['authoritative request', 'problem the user is trying to solve'],
      requiredBySender: { '*': ['authoritative request', 'the problem it solves'] },
    },
    'prompt-engineer': {
      guidanceAnchors: ['authoritative request', 'behavior the prompt must produce'],
      requiredBySender: {
        '*': ['agent behavior the prompt must produce', 'the roles and teams affected'],
      },
    },
    researcher: {
      guidanceAnchors: ['authoritative request', 'research questions'],
      requiredBySender: { '*': ['authoritative request', 'research questions'] },
    },
    reviewer: {
      guidanceAnchors: ['review target and focus'],
      requiredBySender: { '*': ['review target', 'review focus'] },
    },
    specifier: {
      guidanceAnchors: ['work package', '## Rework findings (prior delivery)'],
      requiredBySender: {
        coordinator: [
          '## Summary',
          '## Goal',
          '## User requirements',
          '## Inputs from specialists',
          '## Scope',
          '## Plan phases',
          '## Prior deliveries',
        ],
        builder: REPORT_CONTEXT_BY_SENDER.builder,
      },
    },
    triage: {
      guidanceAnchors: ['observed behavior', 'expected behavior', 'reproduction details'],
      requiredBySender: { '*': ['observed and expected behavior', 'reproduction details'] },
    },
    'uiux-engineer': {
      guidanceAnchors: [
        'authoritative user request',
        'relevant chatroom history',
        'constrain the experience',
      ],
      requiredBySender: { '*': ['authoritative request', 'relevant constraints'] },
    },
    verifier: {
      guidanceAnchors: [
        'verification request',
        'deliverable type',
        'evidence pointers',
        'known gaps',
      ],
      requiredBySender: {
        '*': [
          '## Round',
          '## Mode',
          '## Deliverable type',
          '## User message id',
          '## Log message ids',
          '## Requested test runs',
          '## Claimed outcome',
          '## Evidence pointers',
          '## Known gaps',
        ],
      },
    },
    coordinator: {
      guidanceAnchors: [],
      requiredBySender: {
        architect: REPORT_CONTEXT_BY_SENDER.architect,
        'game-asset-designer': REPORT_CONTEXT_BY_SENDER['game-asset-designer'],
        'product-manager': REPORT_CONTEXT_BY_SENDER['product-manager'],
        'prompt-engineer': REPORT_CONTEXT_BY_SENDER['prompt-engineer'],
        researcher: REPORT_CONTEXT_BY_SENDER.researcher,
        reviewer: REPORT_CONTEXT_BY_SENDER.reviewer,
        specifier: REPORT_CONTEXT_BY_SENDER.specifier,
        triage: REPORT_CONTEXT_BY_SENDER.triage,
        'uiux-engineer': REPORT_CONTEXT_BY_SENDER['uiux-engineer'],
        verifier: REPORT_CONTEXT_BY_SENDER.verifier,
      },
    },
    planner: {
      guidanceAnchors: [],
      requiredBySender: {
        architect: REPORT_CONTEXT_BY_SENDER.architect,
        builder: REPORT_CONTEXT_BY_SENDER.builder,
        'game-asset-designer': REPORT_CONTEXT_BY_SENDER['game-asset-designer'],
        'product-manager': REPORT_CONTEXT_BY_SENDER['product-manager'],
        'prompt-engineer': REPORT_CONTEXT_BY_SENDER['prompt-engineer'],
        researcher: REPORT_CONTEXT_BY_SENDER.researcher,
        reviewer: REPORT_CONTEXT_BY_SENDER.reviewer,
        triage: REPORT_CONTEXT_BY_SENDER.triage,
        'uiux-engineer': REPORT_CONTEXT_BY_SENDER['uiux-engineer'],
        verifier: REPORT_CONTEXT_BY_SENDER.verifier,
      },
    },
    solo: {
      guidanceAnchors: [],
      requiredBySender: {
        architect: REPORT_CONTEXT_BY_SENDER.architect,
        'product-manager': REPORT_CONTEXT_BY_SENDER['product-manager'],
        'prompt-engineer': REPORT_CONTEXT_BY_SENDER['prompt-engineer'],
        triage: REPORT_CONTEXT_BY_SENDER.triage,
        'uiux-engineer': REPORT_CONTEXT_BY_SENDER['uiux-engineer'],
        verifier: REPORT_CONTEXT_BY_SENDER.verifier,
      },
    },
  };

export interface RenderedRolePrompt {
  readonly teamId: string;
  readonly role: string;
  /** Full rendered init prompt, used to verify the recipient's guidance anchors. */
  readonly text: string;
  readonly advertisedTargets: readonly string[];
  readonly availableTargets: readonly string[];
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
  | 'recipient-guidance-drift'
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
  readonly recipientExpectations: Readonly<Record<string, RecipientContextExpectation>>;
  /** Independent spec: pairs whose rendered template must carry the grounding reference block. */
  readonly groundingReferencePairs: readonly GroundingReferencePair[];
}

export type CollectedCrossRoleAuditInput = Omit<CrossRoleAuditInput, 'groundingReferencePairs'>;

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

  return teamRoles.map((role) => {
    const text = renderInitSystemPrompt({ teamId, teamName: preset.name, teamRoles }, role);
    return {
      teamId,
      role,
      text,
      advertisedTargets: parseAdvertisedTargets(`${teamId}: ${role}`, text),
      availableTargets: buildAvailableHandoffRoles({
        teamId,
        teamRoles: [...teamRoles],
        currentRole: role,
        fallbackParticipantRoles: [],
      }),
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
export function collectCrossRoleAuditInput(): CollectedCrossRoleAuditInput {
  return {
    rolePrompts: TEAM_PRESET_IDS.flatMap(collectRolePrompts),
    templates: TEAM_PRESET_IDS.flatMap(collectTemplates),
    recipientExpectations: RECIPIENT_CONTEXT_EXPECTATIONS,
  };
}

/**
 * Audits the rendered cross-role script. Every violation names the mismatched
 * role pair in `pair` and repeats it at the start of `message`.
 */
export function auditCrossRoleScript(input: CrossRoleAuditInput): CrossRoleViolation[] {
  return [
    ...input.rolePrompts.flatMap(auditAdvertisedTargets),
    ...input.templates.flatMap((template) => auditHandoffTemplate(template, input)),
  ];
}

/**
 * Prompt-side promise: the advertised targets are exactly the runtime-available
 * set (`buildAvailableHandoffRoles`), which is contract targets for trio and
 * configured-membership plus `user` for duo/solo.
 */
function auditAdvertisedTargets(prompt: RenderedRolePrompt): CrossRoleViolation[] {
  const available = new Set(prompt.availableTargets);
  const advertised = new Set(prompt.advertisedTargets);
  const violations: CrossRoleViolation[] = [];

  for (const target of prompt.advertisedTargets) {
    if (available.has(target)) continue;
    const pair = `${prompt.teamId}: ${prompt.role} → ${target}`;
    violations.push({
      kind: 'undeclared-target',
      pair,
      message: `${pair} — the ${prompt.role} prompt advertises "${target}", which is not runtime-available for the ${prompt.teamId} team`,
    });
  }

  for (const target of prompt.availableTargets) {
    if (advertised.has(target)) continue;
    const pair = `${prompt.teamId}: ${prompt.role} → ${target}`;
    violations.push({
      kind: 'unadvertised-target',
      pair,
      message: `${pair} — "${target}" is runtime-available to the ${prompt.role} role, but its prompt does not advertise it`,
    });
  }

  return violations;
}

/** Template-side promises: the sender's brief supplies what the recipient expects. */
function auditHandoffTemplate(
  template: RenderedHandoffTemplate,
  input: CrossRoleAuditInput
): CrossRoleViolation[] {
  if (template.toRole === CHATROOM_ROLE_USER) return [];
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
    ...auditRecipientContext(template, pair, input),
    ...auditReturnPaths(template, pair),
    ...auditGroundingReference(template, pair, input.groundingReferencePairs),
  ];
}

function auditRecipientContext(
  template: RenderedHandoffTemplate,
  pair: string,
  input: CrossRoleAuditInput
): CrossRoleViolation[] {
  const expectation = input.recipientExpectations[template.toRole];
  if (!expectation) {
    return [
      {
        kind: 'missing-expectation',
        pair,
        message: `${pair} — no recipient context expectation is declared for "${template.toRole}"`,
      },
    ];
  }

  const violations: CrossRoleViolation[] = [];
  const recipientPrompt = input.rolePrompts.find(
    (prompt) => prompt.teamId === template.teamId && prompt.role === template.toRole
  );

  if (!recipientPrompt) {
    violations.push({
      kind: 'missing-expectation',
      pair,
      message: `${pair} — no rendered guidance is available for the recipient "${template.toRole}"`,
    });
  } else {
    for (const anchor of expectation.guidanceAnchors) {
      if (recipientPrompt.text.includes(anchor)) continue;
      violations.push({
        kind: 'recipient-guidance-drift',
        pair,
        message: `${pair} — the "${template.toRole}" guidance no longer states "${anchor}", so its declared context expectation is stale`,
      });
    }
  }

  const required =
    expectation.requiredBySender[template.fromRole] ?? expectation.requiredBySender['*'];
  if (!required) {
    violations.push({
      kind: 'missing-expectation',
      pair,
      message: `${pair} — no context expectation is declared for "${template.fromRole}" → "${template.toRole}"`,
    });
    return violations;
  }

  const missing = required.filter((token) => !template.text.includes(token));
  if (missing.length > 0) {
    violations.push({
      kind: 'missing-context',
      pair,
      message: `${pair} — the "${template.fromRole}" template does not supply the context "${template.toRole}" expects; missing ${missing
        .map((token) => `"${token}"`)
        .join(', ')}`,
    });
  }

  return violations;
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

/** The grounding block only, starting at its heading. */
function getGroundingReferenceSection(text: string): string | undefined {
  const start = text.indexOf(GROUNDING_REFERENCE_HEADING);
  if (start === -1) return undefined;
  const end = text.indexOf('\n### ', start + GROUNDING_REFERENCE_HEADING.length);
  return text.slice(start, end === -1 ? undefined : end);
}

function auditGroundingReference(
  template: RenderedHandoffTemplate,
  pair: string,
  expectedPairs: readonly GroundingReferencePair[]
): CrossRoleViolation[] {
  const groundingSection = getGroundingReferenceSection(template.text);
  const carries = groundingSection !== undefined;
  const mustCarry = expectedPairs.some(
    (candidate) =>
      candidate.teamId === template.teamId &&
      candidate.fromRole === template.fromRole &&
      candidate.toRole === template.toRole
  );
  if (carries !== mustCarry) {
    return [
      {
        kind: 'grounding-mismatch',
        pair,
        message: `${pair} — the ${template.mode} template ${carries ? 'carries' : 'does not carry'} the grounding reference it ${mustCarry ? 'must' : 'must not'} carry`,
      },
    ];
  }
  if (groundingSection !== undefined && !groundingSection.includes(`--role="${template.toRole}"`)) {
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
