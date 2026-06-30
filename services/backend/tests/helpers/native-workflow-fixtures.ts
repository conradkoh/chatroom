/**
 * Native workflow disclosure — shared fixtures for tests.
 *
 * These tables document what native agents see at init vs task delivery.
 * Integration and unit tests import from here so the matrix stays in one place.
 *
 * Session augmentation (planner → builder): see session-augmentation.ts and
 * tests/integration/native/session-augmentation.spec.ts — handoff task body
 * carries `// data:agent.session_augmentation=none|compact|new_session` (default new_session).
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
  /** Task body used in delivery tests (defaults to generic implementation text). */
  taskContent?: string;
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
    label: 'duo planner receives builder handback → deliver to user',
    teamId: 'duo',
    role: 'planner',
    senderRole: 'builder',
    availableHandoffTargets: ['builder', 'user'],
    primaryHandoffTarget: 'user',
    eagerTemplateHeadings: [
      'Report Template (Planner → User)',
      'Delegation Brief (Planner → Builder)',
    ],
    taskContent: [
      '## Summary',
      'Connectivity test passed.',
      '## Proof of Completion',
      'Not Applicable',
      '## Verification',
      'Not Applicable',
    ].join('\n'),
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
