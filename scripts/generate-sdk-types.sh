#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/generate-sdk-types.sh
#
# Regenerates sdk/typescript/src/types/openapi.generated.ts from
# docs/generated/openapi.json using openapi-typescript.
#
# Run this after exporting the OpenAPI spec whenever the API contract changes:
#
#   npm run export:openapi
#   npm run sdk:generate-types
#   git add sdk/typescript/src/types/openapi.generated.ts
#   git commit -m 'chore(sdk): regenerate types from updated OpenAPI spec'
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

# Pin version for deterministic output
npx --yes openapi-typescript@6 \
  "${OPENAPI_SPEC}" \
  --output "${OUTPUT}"

# Prepend a consistent, non-timestamp header so CI drift checks remain stable
HEADER=$(cat <<'EOF'
/**
 * This file is AUTO-GENERATED from docs/generated/openapi.json.
 * Do NOT edit by hand — run `npm run sdk:generate-types` to regenerate.
 *
 * If CI reports SDK type drift:
 *   1. npm run export:openapi        # re-export the spec from the NestJS app
 *   2. npm run sdk:generate-types    # regenerate this file
 *   3. git add sdk/typescript/src/types/openapi.generated.ts
 *   4. git commit -m 'chore(sdk): regenerate types from updated OpenAPI spec'
 */

EOF
)

# Rebuild the file with the stable header + generated body (strip any existing header)
{
  echo "$HEADER"
  # Drop any leading comment block that openapi-typescript may have emitted
  awk 'BEGIN{skip=1} /^\/\*/{if(skip){next}} /^\s*\*/{if(skip){next}} /^\s*\/\//{if(skip){next}} {skip=0; print}' "${OUTPUT}"
} > "${OUTPUT}.tmp"
mv "${OUTPUT}.tmp" "${OUTPUT}"

echo "[generate-sdk-types] Done. Commit ${OUTPUT} if it changed."
