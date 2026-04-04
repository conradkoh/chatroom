/**
 * Utility functions for generating and validating login codes
 */

/**
 * Generates a random 8-character alphanumeric code (uppercase only)
 * Excludes ambiguous characters like 0, O, 1, I to avoid confusion
 */
export const generateLoginCode = (): string => {
  // Characters used for code generation (excluding ambiguous ones)
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  // Generate 8 random characters
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }

  return code;
};

/**
 * Calculates the expiration timestamp for a login code (1 minute from creation)
 */
export const getCodeExpirationTime = (): number => {
  const now = Date.now();
  const oneMinuteInMs = 60 * 1000;
  return now + oneMinuteInMs;
};

/**
 * Formats a login code with a dash in the middle for better readability
 * Example: "ABCD1234" becomes "ABCD-1234"
 */
export const formatLoginCode = (code: string): string => {
  if (code.length !== 8) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
};

/**
 * Checks if a login code has expired
 */
export const isCodeExpired = (expiresAt: number): boolean => {
  return Date.now() > expiresAt;
};
