/**
 * Model variant encoding — GENERAL entity: the grammar, codec, and validation
 * machinery shared by the server model catalog and the daemon harness services.
 *
 * Grammar (canonical form, produced by {@link encodeModelVariant}):
 *
 *   modelVariant := modelId | modelId '[' params ']'
 *   params       := param (',' param)*
 *   param        := key '=' value
 *
 * Example: "gpt-5.6-sol[reasoning=high]" decodes to
 * `{ model: 'gpt-5.6-sol', params: { reasoning: 'high' } }`.
 * A plain model id decodes to `{ model, params: {} }`.
 *
 * ## What lives here vs. harness-specific entities
 *
 * This module is deliberately HARNESS-AGNOSTIC: it knows no param names and no
 * value vocabularies (e.g. it must not define "reasoning levels" — those mean
 * different things across harnesses; Anthropic exposes thinking AND effort as
 * separate settings). Param vocabularies and their allowed combinations live in
 * per-harness entities (e.g. `codex-sdk.model-variants.ts`), which are passed
 * into {@link validateModelVariantParams} as schemas. A harness with no variant
 * params uses {@link PLAIN_MODEL_SCHEMA} (empty combination only).
 */

// ─── Decoded shape ──────────────────────────────────────────────────────────

export interface DecodedModelVariant {
  /** Base model id without any variant suffix, e.g. "gpt-5.6-sol". */
  model: string;
  /** Variant params keyed by the harness's own vocabulary. */
  params: Record<string, string>;
}

// ─── Schema types ───────────────────────────────────────────────────────────

/** One allowed combination of variant params, e.g. `{ reasoning: 'high' }`. */
export type ModelVariantCombination = Readonly<Record<string, string>>;

/**
 * A harness's variant schema: the exact set of allowed param combinations.
 * A decoded variant is supported iff its params EQUAL one of these — no
 * unknown keys, no extra params, no unsupported value combinations.
 */
export type ModelVariantSchema = readonly ModelVariantCombination[];

/** Schema for harnesses with no variant params: only the empty combination. */
// fallow-ignore-next-line unused-export
export const PLAIN_MODEL_SCHEMA: ModelVariantSchema = [{}];

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Malformed variant string — thrown by strict {@link decodeModelVariant}. */
// fallow-ignore-next-line unused-export
export class ModelVariantParseError extends Error {
  readonly code = 'MODEL_VARIANT_PARSE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ModelVariantParseError';
  }
}

/** Structurally valid but not one of the harness's allowed combinations. */
// fallow-ignore-next-line unused-export
export class ModelVariantValidationError extends Error {
  readonly code = 'MODEL_VARIANT_VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ModelVariantValidationError';
  }
}

// ─── Grammar ────────────────────────────────────────────────────────────────

const MODEL_VARIANT_RE = /^([^\[\]]+?)(?:\[([^\]]*)\])?$/;

/** Whole param `key=value` with allowed charsets (non-empty key and value). */
const PARAM_RE = /^[A-Za-z0-9_-]+=[^,\[\]\=]+$/;

/**
 * Parse and validate a variant params section (the text inside `[...]`).
 * Every param must match `PARAM_RE` (charset + `key=value` form) and keys
 * must be unique. An empty section yields no params (fails the regex instead).
 */
function parseParamList(encoded: string, paramsPart: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const param of paramsPart.split(',')) {
    if (!PARAM_RE.test(param)) {
      throw new ModelVariantParseError(
        `malformed variant param "${param}" in "${encoded}" (expected key=value)`
      );
    }
    const eq = param.indexOf('=');
    const key = param.slice(0, eq);
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      throw new ModelVariantParseError(`duplicate variant param "${key}" in "${encoded}"`);
    }
    params[key] = param.slice(eq + 1);
  }
  return params;
}

/**
 * Strict decode of a model variant string.
 *
 * Throws {@link ModelVariantParseError} on any deviation from canonical form:
 * empty input, empty model id, empty/extra brackets, params not of the form
 * `key=value`, empty keys/values, or duplicate param keys. Harness services
 * rely on this to refuse to start rather than silently misconfigure.
 */
export function decodeModelVariant(encoded: string): DecodedModelVariant {
  if (encoded.length === 0) {
    throw new ModelVariantParseError('empty model variant');
  }

  const match = MODEL_VARIANT_RE.exec(encoded);
  if (!match) {
    throw new ModelVariantParseError(`malformed model variant: "${encoded}"`);
  }
  const [, model, paramsPart] = match;
  if (paramsPart === undefined) {
    return { model, params: {} };
  }

  return { model, params: parseParamList(encoded, paramsPart) };
}

/**
 * Canonical encode — params serialized in insertion order. Inverse of
 * {@link decodeModelVariant}; used by tests and future catalog tooling.
 */
// fallow-ignore-next-line unused-export
export function encodeModelVariant(model: string, params: Record<string, string> = {}): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return model;
  const paramsPart = entries.map(([key, value]) => `${key}=${value}`).join(',');
  return `${model}[${paramsPart}]`;
}

// ─── Schema validation ──────────────────────────────────────────────────────

/** Keys appearing on any allowed combination (distributive — skips the `{}` member). */
type KeysOfUnion<U> = U extends unknown ? keyof U : never;

/** Param values (literal unions) allowed by a schema, keyed by param name. */
export type ValidatedVariantParams<S extends ModelVariantSchema> = {
  [K in KeysOfUnion<S[number]>]: Extract<S[number], Record<K, unknown>>[K];
};

/** A decoded variant validated against schema `S` — params carry literal types. */
export type ValidatedModelVariant<S extends ModelVariantSchema> = DecodedModelVariant & {
  params: Partial<ValidatedVariantParams<S>>;
};

/** Human-readable combo for error messages, e.g. "reasoning=high" / "no params". */
function describeCombination(combo: ModelVariantCombination): string {
  const entries = Object.entries(combo);
  return entries.length === 0 ? 'no params' : entries.map(([k, v]) => `${k}=${v}`).join(',');
}

/**
 * Validate decoded params against a harness's schema.
 *
 * The params must EQUAL one of the schema's allowed combinations exactly —
 * unknown keys, missing keys, extra params, and unsupported value combinations
 * all throw {@link ModelVariantValidationError}. The returned variant is typed
 * with the schema's literal values so callers can map params to SDK options
 * type-safely.
 */
export function validateModelVariantParams<S extends ModelVariantSchema>(
  variant: DecodedModelVariant,
  schema: S
): ValidatedModelVariant<S> {
  const supported = schema.find(
    (combo) =>
      Object.keys(combo).length === Object.keys(variant.params).length &&
      Object.entries(combo).every(([key, value]) => variant.params[key] === value)
  );
  if (!supported) {
    throw new ModelVariantValidationError(
      `unsupported variant params for model "${variant.model}": ` +
        `${describeCombination(variant.params)}; ` +
        `allowed: ${schema.map(describeCombination).join(' | ')}`
    );
  }
  // The params were matched against one allowed combination above, so the
  // narrowed typing is sound.
  return variant as unknown as ValidatedModelVariant<S>;
}
