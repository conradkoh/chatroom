/**
 * Native workflow disclosure — shared fixtures for tests.
 *
 * These tables document what native agents see at init vs task delivery.
 * Integration and unit tests import from here so the matrix stays in one place.
 *
 * Session management (planner → builder): see compress-context-session.ts and
 * tests/integration/native/compress-context-session.spec.ts — handoff task body
 * carries `// data:agent.compress_context=new_session|none` (default new_session).
 */

export const NATIVE_AGENT_HARNESSES = ['cursor-sdk', 'opencode-sdk', 'pi-sdk'] as const;
export type NativeAgentHarness = (typeof NATIVE_AGENT_HARNESSES)[number];

export interface TeamConfig {
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint: string;
  joinRoles: string[];
}

export const TEAM_CONFIGS: Record<string, TeamConfig> = {
  solo: {
    teamId: 'solo',
    teamName: 'Solo Team',
    teamRoles: ['solo'],
    teamEntryPoint: 'solo',
    joinRoles: ['solo'],
  },
  duo: {
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
    joinRoles: ['planner', 'builder'],
  },
  squad: {
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
    joinRoles: ['planner', 'builder', 'reviewer'],
  },
};

export interface NativeInitScenario {
  team: keyof typeof TEAM_CONFIGS;
  role: string;
  entryPoint: boolean;
  soloTeam?: boolean;
  noTaskRead?: boolean;
  /** Planner/solo with builder delegation guidance */
  referencesDeliveryTemplates?: boolean;
}

/** Every native harness × team × role init combination we support. */
export const NATIVE_INIT_SCENARIOS: NativeInitScenario[] = [
  { team: 'solo', role: 'solo', entryPoint: true, soloTeam: true, noTaskRead: true },
  {
    team: 'duo',
    role: 'planner',
    entryPoint: true,
    noTaskRead: true,
    referencesDeliveryTemplates: true,
  },
  { team: 'duo', role: 'builder', entryPoint: false, noTaskRead: true },
  {
    team: 'squad',
    role: 'planner',
    entryPoint: true,
    noTaskRead: true,
    referencesDeliveryTemplates: true,
  },
  { team: 'squad', role: 'builder', entryPoint: false, noTaskRead: true },
  { team: 'squad', role: 'reviewer', entryPoint: false, noTaskRead: true },
];

/**
 * Native task delivery disclosure per team:role.
 *
 * - `primaryHandoffTarget`: step 2 `--next-role` (return to task sender when possible)
 * - `eagerTemplateHeadings`: full templates inlined in `<handoff-templates>` on delivery
 */
export interface NativeDeliveryScenario {
  label: string;
  teamId: keyof typeof TEAM_CONFIGS;
  role: string;
  senderRole: string;
  availableHandoffTargets: string[];
  primaryHandoffTarget: string;
  eagerTemplateHeadings: string[];
  userVerificationInNextSteps?: boolean;
}

export const NATIVE_DELIVERY_SCENARIOS: NativeDeliveryScenario[] = [
  {
    label: 'solo receives user task → deliver report to user',
    teamId: 'solo',
    role: 'solo',
    senderRole: 'user',
    availableHandoffTargets: ['user'],
    primaryHandoffTarget: 'user',
    eagerTemplateHeadings: ['Report Template (Solo → User)'],
    userVerificationInNextSteps: true,
  },
  {
    label:
      'duo planner receives user task → primary handoff user; also has builder delegation template',
    teamId: 'duo',
    role: 'planner',
    senderRole: 'user',
    availableHandoffTargets: ['builder', 'user'],
    primaryHandoffTarget: 'user',
    eagerTemplateHeadings: [
      'Report Template (Planner → User)',
      'Delegation Brief (Planner → Builder)',
    ],
    userVerificationInNextSteps: true,
  },
  {
    label: 'duo builder receives planner delegation → return to planner',
    teamId: 'duo',
    role: 'builder',
    senderRole: 'planner',
    availableHandoffTargets: ['planner'],
    primaryHandoffTarget: 'planner',
    eagerTemplateHeadings: ['Handoff Template (Builder → Planner)'],
  },
  {
    label: 'duo builder receives planner task even when planner not in waiting-participants list',
    teamId: 'duo',
    role: 'builder',
    senderRole: 'planner',
    availableHandoffTargets: ['user'],
    primaryHandoffTarget: 'planner',
    eagerTemplateHeadings: ['Handoff Template (Builder → Planner)'],
  },
  {
    label:
      'squad planner receives user task → primary user; templates for builder and reviewer too',
    teamId: 'squad',
    role: 'planner',
    senderRole: 'user',
    availableHandoffTargets: ['builder', 'reviewer', 'user'],
    primaryHandoffTarget: 'user',
    eagerTemplateHeadings: [
      'Report Template (Planner → User)',
      'Delegation Brief (Planner → Builder)',
      'Review Request Brief (Planner → Reviewer)',
    ],
    userVerificationInNextSteps: true,
  },
  {
    label:
      'squad builder receives planner delegation → return to planner; reviewer template for alternate path',
    teamId: 'squad',
    role: 'builder',
    senderRole: 'planner',
    availableHandoffTargets: ['reviewer', 'planner'],
    primaryHandoffTarget: 'planner',
    eagerTemplateHeadings: ['Handoff Template (Builder → Reviewer)'],
  },
  {
    label:
      'squad reviewer receives builder handoff → return to builder; planner rework template available',
    teamId: 'squad',
    role: 'reviewer',
    senderRole: 'builder',
    availableHandoffTargets: ['builder', 'planner'],
    primaryHandoffTarget: 'builder',
    eagerTemplateHeadings: [
      'Review Outcome (Reviewer → Planner)',
      'Rework Feedback (Reviewer → Builder)',
    ],
  },
];

export function getNativeDeliveryScenario(match: string): NativeDeliveryScenario {
  const scenario = NATIVE_DELIVERY_SCENARIOS.find((s) => s.label.includes(match));
  if (!scenario) {
    throw new Error(`missing native delivery scenario matching "${match}"`);
  }
  return scenario;
}

/** Documented section order in native task delivery output. */
export const NATIVE_DELIVERY_SECTION_ORDER = [
  '<task>',
  '</task>',
  '<next-steps>',
  '</next-steps>',
  '<handoff-templates>',
  '</handoff-templates>',
  '<handoffs>',
] as const;

export function indexOfSectionLine(output: string, tag: string): number {
  const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm');
  const match = re.exec(output);
  return match?.index ?? -1;
}
