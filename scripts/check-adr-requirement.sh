#!/bin/bash

# ADR Requirement Checker for CI
# Enforces that PRs modifying architecturally-significant paths include an ADR
#
# Usage: ./scripts/check-adr-requirement.sh [base-branch] [pr-number] [github-token]
# Example: ./scripts/check-adr-requirement.sh main 123 $GITHUB_TOKEN

set -e

BASE_BRANCH="${1:-main}"
PR_NUMBER="${2:-$GITHUB_PR_NUMBER}"
GITHUB_TOKEN="${3:-$GITHUB_TOKEN}"

# Paths that require ADR documentation when modified
SIGNIFICANT_PATHS=(
  "src/graphQL-API/"
  "src/stellar/"
  "src/auth/"
  "src/common/error-classification/"
  "src/database/"
  "src/cache/"
  "src/common/middleware/"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Checking ADR requirement for PR #$PR_NUMBER..."

# Get list of changed files in this PR
if [ -n "$GITHUB_TOKEN" ] && [ -n "$PR_NUMBER" ]; then
  # GitHub Actions environment: fetch files from API
  CHANGED_FILES=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/AgesEmpire/StellarSwipe-Backends/pulls/$PR_NUMBER/files" \
    | grep '"filename"' | cut -d'"' -f4 | sort | uniq)
else
  # Local development: use git diff
  CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD 2>/dev/null || git diff --name-only)
fi

if [ -z "$CHANGED_FILES" ]; then
  echo -e "${YELLOW}⚠️  No files changed or unable to determine changes${NC}"
  exit 0
fi

# Check if any significant paths were modified
MODIFIED_SIGNIFICANT=false
MODIFIED_FILES=""

while IFS= read -r file; do
  for path in "${SIGNIFICANT_PATHS[@]}"; do
    if [[ "$file" == "$path"* ]]; then
      MODIFIED_SIGNIFICANT=true
      MODIFIED_FILES="$MODIFIED_FILES  - $file"$'\n'
      break
    fi
  done
done <<< "$CHANGED_FILES"

if [ "$MODIFIED_SIGNIFICANT" = false ]; then
  echo -e "${GREEN}✓ No architecturally-significant paths modified${NC}"
  exit 0
fi

echo -e "${YELLOW}Modified architecturally-significant files:${NC}"
echo -e "$MODIFIED_FILES"

# Check for ADR in commit messages or PR title/body
ADR_FOUND=false
PR_DESC=""

if [ -n "$GITHUB_TOKEN" ] && [ -n "$PR_NUMBER" ]; then
  # Get PR title and body from API
  PR_DATA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/AgesEmpire/StellarSwipe-Backends/pulls/$PR_NUMBER")
  PR_DESC=$(echo "$PR_DATA" | grep -o '"body":"[^"]*"' | head -1 | cut -d'"' -f4)
  PR_TITLE=$(echo "$PR_DATA" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)

  if echo "$PR_TITLE $PR_DESC" | grep -iE "(adr[- ]?[0-9]+|docs/adr/|architecture decision)" > /dev/null; then
    ADR_FOUND=true
  fi

  # Also check commit messages
  if git log --oneline "$BASE_BRANCH"...HEAD 2>/dev/null | grep -iE "(adr[- ]?[0-9]+|docs/adr/)" > /dev/null; then
    ADR_FOUND=true
  fi
else
  # Local mode: check commit messages
  if git log --oneline "$BASE_BRANCH"...HEAD 2>/dev/null | grep -iE "(adr[- ]?[0-9]+|docs/adr/)" > /dev/null; then
    ADR_FOUND=true
  fi
fi

# Check for exemption label in PR
EXEMPTION_FOUND=false
if [ -n "$GITHUB_TOKEN" ] && [ -n "$PR_NUMBER" ]; then
  LABELS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/AgesEmpire/StellarSwipe-Backends/pulls/$PR_NUMBER" \
    | grep -o '"name":"[^"]*"' | grep -i exemption)

  if [ -n "$LABELS" ]; then
    EXEMPTION_FOUND=true
  fi
fi

if [ "$ADR_FOUND" = true ]; then
  echo -e "${GREEN}✓ ADR documentation found or referenced${NC}"
  exit 0
fi

if [ "$EXEMPTION_FOUND" = true ]; then
  echo -e "${YELLOW}⚠️  ADR-exemption label applied. Please document justification in PR description.${NC}"
  exit 0
fi

# No ADR found and no exemption
echo -e "${RED}✗ ADR documentation required${NC}"
echo ""
echo "This PR modifies architecturally-significant code. Please:"
echo ""
echo "1. Create or reference an ADR in this PR:"
echo "   - Create: docs/adr/NNNN-your-title.md (use next sequence number)"
echo "   - Reference: Mention ADR number in PR description or commit message"
echo ""
echo "2. Or, if an ADR doesn't apply:"
echo "   - Add the 'adr-exemption' label to this PR"
echo "   - Document your justification in the PR description"
echo ""
echo "For guidance, see: docs/adr/README.md"
echo ""
exit 1
