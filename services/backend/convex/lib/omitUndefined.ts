type WithoutUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Removes undefined-valued fields while preserving required fields in the static type. */
export function omitUndefined<const T extends Record<string, unknown>>(
  value: T
): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as WithoutUndefined<T>;
}
