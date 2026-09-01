import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

export function parseModelId(model: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const slashIdx = model.indexOf('/');
  if (slashIdx === -1) return undefined;
  const providerID = model.substring(0, slashIdx);
  const modelID = model.substring(slashIdx + 1);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

// fallow-ignore-next-line complexity
export function parseOpencodeSpawnModel(model: string): {
  model: string;
  variant?: string;
} {
  if (!model.includes('[')) return { model };

  const decoded = decodeModelVariant(model);
  const variant = decoded.params.variant;
  let resolvedModel = decoded.model;

  if (!resolvedModel.includes('/')) {
    const slashIdx = model.indexOf('/');
    const bracketIdx = model.indexOf('[');
    if (slashIdx !== -1 && slashIdx < bracketIdx) {
      resolvedModel = `${model.slice(0, slashIdx)}/${resolvedModel}`;
    }
  }

  return { model: resolvedModel, ...(variant ? { variant } : {}) };
}

export const isInfoLine = (line: string): boolean => line.trimStart().startsWith('INFO ');
