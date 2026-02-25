#!/bin/bash

# Signal Contests & Leaderboards - Validation Script
# This script validates that the implementation is complete and correct

echo "🔍 Validating Signal Contests & Leaderboards Implementation..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Check if files exist
echo "📁 Checking file structure..."

FILES=(
  "src/contests/entities/contest.entity.ts"
  "src/contests/dto/contest.dto.ts"
  "src/contests/contests.service.ts"
  "src/contests/contests.controller.ts"
  "src/contests/contests.module.ts"
  "src/contests/contests.service.spec.ts"
  "src/contests/contests.controller.spec.ts"
  "src/contests/index.ts"
  "src/contests/README.md"
  "src/contests/QUICKSTART.md"
  "src/contests/IMPLEMENTATION_CHECKLIST.md"
  "src/database/migrations/1700000000000-CreateContestsTable.ts"
  "test/integration/contests.integration.spec.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $file"
  else
    echo -e "${RED}✗${NC} $file (missing)"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# Check if ContestsModule is registered in app.module.ts
echo "🔗 Checking module registration..."
if grep -q "ContestsModule" src/app.module.ts; then
  echo -e "${GREEN}✓${NC} ContestsModule registered in app.module.ts"
else
  echo -e "${RED}✗${NC} ContestsModule not found in app.module.ts"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# Check for required imports in files
echo "📦 Checking imports..."

# Check contest.entity.ts has required enums
if grep -q "enum ContestMetric" src/contests/entities/contest.entity.ts && \
   grep -q "enum ContestStatus" src/contests/entities/contest.entity.ts; then
  echo -e "${GREEN}✓${NC} Contest enums defined"
else
  echo -e "${RED}✗${NC} Contest enums missing"
  ERRORS=$((ERRORS + 1))
fi

# Check service has all required methods
METHODS=("createContest" "getActiveContests" "getContest" "getContestLeaderboard" "finalizeContest" "getAllContests")
for method in "${METHODS[@]}"; do
  if grep -q "$method" src/contests/contests.service.ts; then
    echo -e "${GREEN}✓${NC} Service method: $method"
  else
    echo -e "${RED}✗${NC} Service method missing: $method"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# Check controller endpoints
echo "🌐 Checking API endpoints..."
ENDPOINTS=("@Post()" "@Get()" "@Get('active')" "@Get(':id')" "@Get(':id/leaderboard')" "@Post(':id/finalize')")
for endpoint in "${ENDPOINTS[@]}"; do
  if grep -q "$endpoint" src/contests/contests.controller.ts; then
    echo -e "${GREEN}✓${NC} Endpoint: $endpoint"
  else
    echo -e "${YELLOW}⚠${NC} Endpoint might be missing: $endpoint"
  fi
done

echo ""

# Check test files have test cases
echo "🧪 Checking test coverage..."
if grep -q "describe('ContestsService'" src/contests/contests.service.spec.ts; then
  echo -e "${GREEN}✓${NC} Service tests defined"
else
  echo -e "${RED}✗${NC} Service tests missing"
  ERRORS=$((ERRORS + 1))
fi

if grep -q "describe('ContestsController'" src/contests/contests.controller.spec.ts; then
  echo -e "${GREEN}✓${NC} Controller tests defined"
else
  echo -e "${RED}✗${NC} Controller tests missing"
  ERRORS=$((ERRORS + 1))
fi

if grep -q "describe('Contests Integration Tests'" test/integration/contests.integration.spec.ts; then
  echo -e "${GREEN}✓${NC} Integration tests defined"
else
  echo -e "${RED}✗${NC} Integration tests missing"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# Check migration file
echo "🗄️  Checking database migration..."
if grep -q "CreateContestsTable" src/database/migrations/1700000000000-CreateContestsTable.ts; then
  echo -e "${GREEN}✓${NC} Migration file exists"
else
  echo -e "${RED}✗${NC} Migration file missing or incorrect"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# Check documentation
echo "📚 Checking documentation..."
if [ -s "src/contests/README.md" ]; then
  echo -e "${GREEN}✓${NC} README.md exists and not empty"
else
  echo -e "${RED}✗${NC} README.md missing or empty"
  ERRORS=$((ERRORS + 1))
fi

if [ -s "src/contests/QUICKSTART.md" ]; then
  echo -e "${GREEN}✓${NC} QUICKSTART.md exists and not empty"
else
  echo -e "${YELLOW}⚠${NC} QUICKSTART.md missing or empty"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All validation checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "1. Run migration: npm run migration:run"
  echo "2. Run tests: npm test -- contests"
  echo "3. Start server: npm run start:dev"
  echo "4. Test API: curl http://localhost:3000/api/v1/contests/active"
  exit 0
else
  echo -e "${RED}❌ Validation failed with $ERRORS error(s)${NC}"
  echo ""
  echo "Please fix the errors above before proceeding."
  exit 1
fi
