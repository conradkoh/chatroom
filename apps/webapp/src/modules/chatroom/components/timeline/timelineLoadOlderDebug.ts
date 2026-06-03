const PREFIX = '[timeline:load-older]';

/** Dev-only tracing for load-older triggers, guards, and fetch results. */
export function logLoadOlder(phase: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  if (details !== undefined) {
    console.debug(PREFIX, phase, details);
  } else {
    console.debug(PREFIX, phase);
  }
}
