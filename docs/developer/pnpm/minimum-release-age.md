# pnpm minimum release age

This workspace delays installing **newly published** npm package versions so compromised releases are more likely to be removed from the registry before they land in the tree.

## Configuration

Set in [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml):

| Setting                   | Value  | Meaning                                                                               |
| ------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `minimumReleaseAge`       | `1440` | Only install versions published at least **24 hours** ago                             |
| `minimumReleaseAgeStrict` | `true` | Fail resolution if no version in range meets the age requirement (no silent fallback) |

The delay applies to **all** dependencies, including transitive ones.

## Day-to-day behavior

- **Existing lockfile:** `pnpm install` with a committed `pnpm-lock.yaml` keeps current pinned versions; the setting mainly affects `pnpm add`, `pnpm update`, and lockfile refreshes.
- **Fresh installs:** Resolution respects the minimum age when choosing versions.

## Urgent or security patches

When a fix must be installed before it is 24 hours old, add the package to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - vulnerable-package@6.6.7
```

`pnpm audit --fix` can add entries here automatically for patched versions.

To bypass temporarily (local only), use a one-off install with `minimumReleaseAge` set to `0` via CLI or env — prefer exclusions in the repo for audited exceptions.

## References

- [pnpm settings: minimumReleaseAge](https://pnpm.io/settings#minimumreleaseage)
- [pnpm 11 release notes](https://pnpm.io/blog/releases/11.0) (defaults and supply-chain features)
