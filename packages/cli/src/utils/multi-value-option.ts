/** Commander `.option()` accumulator for repeatable flags (e.g. --artifact). */
export function collectMultiValueOption(value: string, previous?: string[]): string[] {
  return previous ? [...previous, value] : [value];
}
