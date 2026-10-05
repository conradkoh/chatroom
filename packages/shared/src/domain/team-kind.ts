export const TEAM_PRESET_IDS = ['duo', 'solo'] as const;
export type TeamPresetId = (typeof TEAM_PRESET_IDS)[number];
