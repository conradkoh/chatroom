import { createHash } from 'node:crypto';

export interface GitStateFieldDef<
  TRaw = unknown,
  THashable = unknown,
  TPart extends Record<string, unknown> = Record<string, unknown>,
> {
  key: string;
  includeInSlim: boolean;
  collect: (workingDir: string) => Promise<TRaw>;
  toHashable: (raw: TRaw) => THashable;
  toMutationPartial: (raw: TRaw) => TPart;
  defaultValue: TRaw;
}

export class GitStatePipeline {
  private readonly fields: GitStateFieldDef[];

  constructor(fields: GitStateFieldDef[]) {
    this.fields = fields;
  }

  async collect(
    workingDir: string,
    preCollected?: Map<string, unknown>
  ): Promise<Map<string, unknown>> {
    const results = new Map(preCollected);

    if (this.fields.length === 0) return results;

    const entries = await Promise.all(
      this.fields
        .filter((f) => !results.has(f.key))
        .map(async (field) => {
          try {
            const raw = await field.collect(workingDir);
            return { key: field.key, raw } as const;
          } catch {
            return { key: field.key, raw: field.defaultValue } as const;
          }
        })
    );

    for (const { key, raw } of entries) {
      results.set(key, raw);
    }

    return results;
  }

  /**
   * Compute MD5 hash over JSON-serialized field values.
   *
   * Hash stability depends on field insertion order (the order of `this.fields`),
   * which is deterministic for string keys in V8 / modern JS engines.
   * Adding, removing, or reordering fields will change the hash output.
   */
  computeHash(values: Map<string, unknown>, slim: boolean): string {
    const hashInput: Record<string, unknown> = {};

    for (const field of this.fields) {
      if (slim && !field.includeInSlim) continue;
      const raw = values.get(field.key) ?? field.defaultValue;
      hashInput[field.key] = field.toHashable(raw);
    }

    return createHash('md5').update(JSON.stringify(hashInput)).digest('hex');
  }

  toMutationArgs(values: Map<string, unknown>, slim: boolean): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    for (const field of this.fields) {
      if (slim && !field.includeInSlim) continue;
      const raw = values.get(field.key) ?? field.defaultValue;
      Object.assign(args, field.toMutationPartial(raw));
    }

    args.pipelineMode = slim ? 'slim' : 'full';

    return args;
  }
}
