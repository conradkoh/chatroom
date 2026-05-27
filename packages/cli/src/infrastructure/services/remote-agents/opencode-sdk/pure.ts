export function parseModelId(model: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const slashIdx = model.indexOf('/');
  if (slashIdx === -1) return undefined;
  const providerID = model.substring(0, slashIdx);
  const modelID = model.substring(slashIdx + 1);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export const isInfoLine = (line: string): boolean => line.trimStart().startsWith('INFO ');
