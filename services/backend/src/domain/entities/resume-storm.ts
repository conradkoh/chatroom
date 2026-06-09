/**
 * Classified reason when auto-resume aborts due to rapid agent_end events.
 */

export type ResumeStormReason = 'unknown' | 'auth_error' | 'rate_limit' | 'config_error';
