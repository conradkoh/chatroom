/**
 * Formats an alphanumeric code input with an optional dash after the fourth character.
 */
export function formatCodeInputValue(rawValue: string): string {
  const value = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (value.length <= 4) {
    return value;
  }

  if (value.length <= 8) {
    return `${value.slice(0, 4)}-${value.slice(4, 8)}`;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 8)}`;
}
