/**
 * Compile-time exhaustiveness check. Place at the end of a switch on a union to
 * guarantee all variants are handled. The `never` parameter ensures TS errors
 * if a new variant is added without a case.
 */
export function exhaustive(value: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(value)}`);
}
