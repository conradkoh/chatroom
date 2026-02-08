/**
 * Database Migrations
 *
 * Internal mutations and actions for one-off data migrations.
 * Run from the Convex dashboard as internal functions.
 *
 * All previous migrations have been executed and removed:
 * - Session expiration field removal (deprecated expiresAt/expiresAtLabel)
 * - User access level defaults (set undefined → 'user')
 * - Task origin normalization (set undefined → 'chat'/'backlog')
 * - Tool → Harness field rename (availableTools → availableHarnesses, etc.)
 */
