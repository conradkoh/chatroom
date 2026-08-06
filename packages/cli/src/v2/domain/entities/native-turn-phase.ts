// fallow-ignore-next-line unused-export
export const NATIVE_TURN_PHASES = ['idle', 'injecting', 'turn_in_flight'] as const;
export type NativeTurnPhase = (typeof NATIVE_TURN_PHASES)[number];
