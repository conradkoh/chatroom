import type { ConvexBackendMode, RuntimeConfig, RuntimeConfigDefaults } from './protocol.js';

/** Single source of truth for fallback runtime values when no saved config or env exists. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  webappPort: 3000,
  convexBackendMode: 'local',
  convexPort: 3210,
  convexUrl: 'http://127.0.0.1:3210',
};

/**
 * Extracts the stack config from defaults. The explicit field list ensures a compile
 * error if RuntimeConfig gains a new required field but this helper is not updated.
 */
export function runtimeConfigFromDefaults(defaults: RuntimeConfigDefaults): RuntimeConfig {
  const config: RuntimeConfig = {
    webappPort: defaults.webappPort,
    convexBackendMode: defaults.convexBackendMode,
    convexPort: defaults.convexPort,
    convexUrl: defaults.convexUrl,
  };
  return config;
}

/** Compile-time guard: every RuntimeConfig key must exist on RuntimeConfigDefaults. */
type RuntimeConfigKeysInDefaults = {
  [K in keyof RuntimeConfig]: K extends keyof RuntimeConfigDefaults ? true : never;
};
const _runtimeConfigKeysInDefaults: RuntimeConfigKeysInDefaults = {
  webappPort: true,
  convexBackendMode: true,
  convexPort: true,
  convexUrl: true,
};
void _runtimeConfigKeysInDefaults;

export function defaultConvexBackendMode(hostedUrl: string | null): ConvexBackendMode {
  return hostedUrl && hostedUrl.includes('.convex.cloud') ? 'hosted' : 'local';
}
