// fallow-ignore-next-line unused-export
export const INTEGRATION_NAME_MAX_LENGTH = 80;
// fallow-ignore-next-line unused-export
export const INTEGRATION_DESCRIPTION_MAX_LENGTH = 500;

export type IntegrationDetailField = 'name' | 'description';

export type IntegrationDetailResult =
  | { ok: true; value: string | undefined } // undefined = unset (empty or whitespace-only input)
  | {
      ok: false;
      field: IntegrationDetailField;
      maxLength: number;
      length: number;
      message: string;
    };

const MAX_LENGTH: Record<IntegrationDetailField, number> = {
  name: INTEGRATION_NAME_MAX_LENGTH,
  description: INTEGRATION_DESCRIPTION_MAX_LENGTH,
};

/** Trim; empty -> unset; over-limit (UTF-16 length, the same unit as HTML maxLength) -> error. */
export function normalizeIntegrationDetail(
  field: IntegrationDetailField,
  raw: string
): IntegrationDetailResult {
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: undefined };
  const maxLength = MAX_LENGTH[field];
  if (value.length > maxLength) {
    const label = field === 'name' ? 'Name' : 'Description';
    return {
      ok: false,
      field,
      maxLength,
      length: value.length,
      message: `${label} must be ${maxLength} characters or fewer (got ${value.length}).`,
    };
  }
  return { ok: true, value };
}
