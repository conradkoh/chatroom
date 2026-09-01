// fallow-ignore-file code-duplication
import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

/** Pi CLI valid --thinking values. `max` is NOT valid — use xhigh as ceiling. */
// fallow-ignore-next-line unused-export
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
// fallow-ignore-next-line unused-type
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

// fallow-ignore-next-line complexity
export function parsePiSpawnModel(model: string): {
  model: string;
  thinking?: string;
} {
  if (!model.includes('[')) return { model };

  const decoded = decodeModelVariant(model);
  const thinking = decoded.params.thinking;
  let resolvedModel = decoded.model;

  if (!resolvedModel.includes('/')) {
    const slashIdx = model.indexOf('/');
    const bracketIdx = model.indexOf('[');
    if (slashIdx !== -1 && slashIdx < bracketIdx) {
      resolvedModel = `${model.slice(0, slashIdx)}/${resolvedModel}`;
    }
  }

  return { model: resolvedModel, ...(thinking ? { thinking } : {}) };
}
