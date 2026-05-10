/** Model key utilities: convert between "<providerID>::<modelID>" and parts. */

/** Parse a "<providerID>::<modelID>" key into model object or undefined. */
export function parseModelKey(
  key: string | undefined
): { providerID: string; modelID: string } | undefined {
  if (!key) return undefined;
  const [providerID, modelID] = key.split('::');
  if (providerID && modelID) return { providerID, modelID };
  return undefined;
}
