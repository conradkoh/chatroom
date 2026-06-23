/** Harnesses that use native task injection (no CLI listen loop). */
export const NATIVE_AGENT_HARNESSES = ['cursor-sdk', 'opencode-sdk', 'pi-sdk'] as const;

export type NativeAgentHarness = (typeof NATIVE_AGENT_HARNESSES)[number];
