#!/usr/bin/env bash
# Run typecheck + test for packages affected since the push base ref.
# Invoked by .husky/pre-push — keeps git push fast enough to finish within agent/human timeouts.
set -euo pipefail

REMOTE="${1:-origin}"
REMOTE_URL="${2:-}"

bun run test:scripts

resolve_base_ref() {
  local branch upstream fallback

  branch="$(git rev-parse --abbrev-ref HEAD)"

  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$upstream" ] && git rev-parse --verify "$upstream" >/dev/null 2>&1; then
    printf '%s' "$upstream"
    return
  fi

  if git rev-parse --verify "${REMOTE}/${branch}" >/dev/null 2>&1; then
    printf '%s' "${REMOTE}/${branch}"
    return
  fi

  for fallback in "${REMOTE}/master" "${REMOTE}/main"; do
    if git rev-parse --verify "$fallback" >/dev/null 2>&1; then
      printf '%s' "$fallback"
      return
    fi
  done

  printf 'HEAD~1'
}

BASE="$(resolve_base_ref)"
FILTER="...[${BASE}]"

echo "Running pre-push checks (affected since ${BASE})..."
echo "→ pnpm turbo run typecheck test --filter=${FILTER}"
pnpm turbo run typecheck test --filter="${FILTER}"

bun scripts/run-pre-push-e2e.ts "$REMOTE" "$REMOTE_URL"

echo "All pre-push checks passed. Proceeding with push."
