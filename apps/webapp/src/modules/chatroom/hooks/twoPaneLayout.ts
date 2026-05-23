export function isValidTwoPaneLayout(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    value[0] >= 0 &&
    value[0] <= 100 &&
    typeof value[1] === 'number' &&
    value[1] >= 0 &&
    value[1] <= 100
  );
}
