#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/generate-sdk-types.sh
#
# Regenerates sdk/typescript/src/types/index.ts from docs/generated/openapi.json
# using openapi-typescript.  Run this after exporting the OpenAPI spec whenever
# the API contract changes.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENAPI_SPEC="${REPO_ROOT}/docs/generated/openapi.json"
OUTPUT="${REPO_ROOT}/sdk/typescript/src/types/openapi.generated.ts"

if [[ ! -f "${OPENAPI_SPEC}" ]]; then
  echo "ERROR: OpenAPI spec not found at ${OPENAPI_SPEC}. Run 'npm run export:openapi' first." >&2
  exit 1
fi

echo "[generate-sdk-types] Generating types from ${OPENAPI_SPEC} → ${OUTPUT}"

npx --yes openapi-typescript@6 \
  "${OPENAPI_SPEC}" \
  --output "${OUTPUT}"

echo "[generate-sdk-types] Done. Commit ${OUTPUT} if it changed."
