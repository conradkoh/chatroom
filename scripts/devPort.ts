// fallow-ignore-file unused-export

/** IANA dynamic/private (ephemeral) port range — primary collision avoidance for setup. */
export const MIN_DEV_PORT = 49152;
export const MAX_DEV_PORT = 65535;

const MAX_GENERATION_ATTEMPTS = 100;

/**
 * Well-known service ports — documented for validation and future range changes.
 * All entries are below MIN_DEV_PORT today, so they do not affect generateRandomDevPort().
 * Collision avoidance for setup comes from using the IANA ephemeral range.
 */
export const BLACKLISTED_DEV_PORTS: ReadonlySet<number> = new Set([
  // Node / frontend dev servers
  3000, 3001, 3002, 4000, 4200, 4321, 5000, 5173,
  // Databases & message brokers
  3306, 5432, 5672, 6379, 11211, 15672, 27017,
  // HTTP / app servers
  8000, 8080, 8443, 8888, 9000, 9001,
]);

export function isBlacklistedDevPort(port: number): boolean {
  return BLACKLISTED_DEV_PORTS.has(port);
}

export function isValidDevPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_DEV_PORT && port <= MAX_DEV_PORT;
}

/** Rejection-sampling picker — exported for unit tests (exhaustion path). */
export function pickRandomPortInRange(
  min: number,
  max: number,
  isRejected: (port: number) => boolean,
  random: () => number = Math.random,
  maxAttempts: number = MAX_GENERATION_ATTEMPTS
): number {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = min + Math.floor(random() * (max - min + 1));
    if (!isRejected(port)) {
      return port;
    }
  }
  throw new Error(`Failed to generate port after ${maxAttempts} attempts`);
}

export function generateRandomDevPort(random: () => number = Math.random): number {
  return pickRandomPortInRange(
    MIN_DEV_PORT,
    MAX_DEV_PORT,
    isBlacklistedDevPort,
    random,
    MAX_GENERATION_ATTEMPTS
  );
}
