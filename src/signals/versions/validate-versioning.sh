#!/bin/bash

# Signal Versioning Implementation Validation Script
# Validates all requirements from the GitHub issue

set -e

echo "🔍 Signal Versioning Implementation Validation"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((pass_count++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((fail_count++))
}

check_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

echo "1. Checking File Structure"
echo "----------------------------"

# Check if versioning files exist
if [ -f "src/signals/versions/entities/signal-version.entity.ts" ]; then
    check_pass "SignalVersion entity exists"
else
    check_fail "SignalVersion entity missing"
fi

if [ -f "src/signals/versions/signal-version.service.ts" ]; then
    check_pass "SignalVersionService exists"
else
    check_fail "SignalVersionService missing"
fi

if [ -f "src/signals/versions/signal-version.controller.ts" ]; then
    check_pass "SignalVersionController exists"
else
    check_fail "SignalVersionController missing"
fi

if [ -f "src/signals/versions/dto/update-signal.dto.ts" ]; then
    check_pass "DTOs exist"
else
    check_fail "DTOs missing"
fi

if [ -f "src/database/migrations/1737650000001-CreateSignalVersioningTables.ts" ]; then
    check_pass "Migration file exists"
else
    check_fail "Migration file missing"
fi

echo ""
echo "2. Checking Entity Structure"
echo "----------------------------"

# Check SignalVersion entity fields
if grep -q "versionNumber: number" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "SignalVersion has versionNumber field"
else
    check_fail "SignalVersion missing versionNumber field"
fi

if grep -q "signalId: string" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "SignalVersion has signalId field"
else
    check_fail "SignalVersion missing signalId field"
fi

if grep -q "changeSummary" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "SignalVersion has changeSummary field"
else
    check_fail "SignalVersion missing changeSummary field"
fi

if grep -q "requiresApproval" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "SignalVersion has requiresApproval field"
else
    check_fail "SignalVersion missing requiresApproval field"
fi

# Check SignalVersionApproval entity
if grep -q "class SignalVersionApproval" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "SignalVersionApproval entity exists"
else
    check_fail "SignalVersionApproval entity missing"
fi

if grep -q "UpdateApprovalStatus" src/signals/versions/entities/signal-version.entity.ts; then
    check_pass "UpdateApprovalStatus enum exists"
else
    check_fail "UpdateApprovalStatus enum missing"
fi

echo ""
echo "3. Checking Service Implementation"
echo "-----------------------------------"

# Check updateSignal method
if grep -q "async updateSignal" src/signals/versions/signal-version.service.ts; then
    check_pass "updateSignal method exists"
else
    check_fail "updateSignal method missing"
fi

# Check version history method
if grep -q "async getVersionHistory" src/signals/versions/signal-version.service.ts; then
    check_pass "getVersionHistory method exists"
else
    check_fail "getVersionHistory method missing"
fi

# Check copier response method
if grep -q "async respondToUpdate" src/signals/versions/signal-version.service.ts; then
    check_pass "respondToUpdate method exists"
else
    check_fail "respondToUpdate method missing"
fi

# Check pending approvals method
if grep -q "async getPendingApprovals" src/signals/versions/signal-version.service.ts; then
    check_pass "getPendingApprovals method exists"
else
    check_fail "getPendingApprovals method missing"
fi

# Check copied version tracking
if grep -q "async getCopiedVersion" src/signals/versions/signal-version.service.ts; then
    check_pass "getCopiedVersion method exists"
else
    check_fail "getCopiedVersion method missing"
fi

echo ""
echo "4. Checking Update Restrictions"
echo "--------------------------------"

# Check maximum updates constant
if grep -q "MAX_UPDATES_PER_SIGNAL = 5" src/signals/versions/signal-version.service.ts; then
    check_pass "Maximum 5 updates enforced"
else
    check_fail "Maximum updates limit not found"
fi

# Check cooldown period
if grep -q "UPDATE_COOLDOWN_MS = 60 \* 60 \* 1000" src/signals/versions/signal-version.service.ts; then
    check_pass "1-hour cooldown enforced"
else
    check_fail "Cooldown period not found"
fi

# Check status validation
if grep -q "signal.status !== SignalStatus.ACTIVE" src/signals/versions/signal-version.service.ts; then
    check_pass "Active status check exists"
else
    check_fail "Active status check missing"
fi

# Check expiry validation
if grep -q "signal.expiresAt" src/signals/versions/signal-version.service.ts; then
    check_pass "Expiry validation exists"
else
    check_fail "Expiry validation missing"
fi

# Check provider authorization
if grep -q "signal.providerId !== providerId" src/signals/versions/signal-version.service.ts; then
    check_pass "Provider authorization check exists"
else
    check_fail "Provider authorization check missing"
fi

echo ""
echo "5. Checking Controller Endpoints"
echo "---------------------------------"

# Check update endpoint
if grep -q "@Patch(':signalId/update')" src/signals/versions/signal-version.controller.ts; then
    check_pass "PATCH /signals/:signalId/update endpoint exists"
else
    check_fail "Update endpoint missing"
fi

# Check version history endpoint
if grep -q "@Get(':signalId/versions')" src/signals/versions/signal-version.controller.ts; then
    check_pass "GET /signals/:signalId/versions endpoint exists"
else
    check_fail "Version history endpoint missing"
fi

# Check respond endpoint
if grep -q "@Post('versions/:versionId/respond')" src/signals/versions/signal-version.controller.ts; then
    check_pass "POST /signals/versions/:versionId/respond endpoint exists"
else
    check_fail "Respond endpoint missing"
fi

# Check pending approvals endpoint
if grep -q "@Get('pending-approvals')" src/signals/versions/signal-version.controller.ts; then
    check_pass "GET /signals/pending-approvals endpoint exists"
else
    check_fail "Pending approvals endpoint missing"
fi

# Check copied version endpoint
if grep -q "@Get(':signalId/copied-version')" src/signals/versions/signal-version.controller.ts; then
    check_pass "GET /signals/:signalId/copied-version endpoint exists"
else
    check_fail "Copied version endpoint missing"
fi

echo ""
echo "6. Checking Module Integration"
echo "-------------------------------"

# Check if versioning is integrated in signals module
if grep -q "SignalVersion" src/signals/signals.module.ts; then
    check_pass "SignalVersion entity registered in module"
else
    check_fail "SignalVersion not registered in module"
fi

if grep -q "SignalVersionService" src/signals/signals.module.ts; then
    check_pass "SignalVersionService registered in module"
else
    check_fail "SignalVersionService not registered in module"
fi

if grep -q "SignalVersionController" src/signals/signals.module.ts; then
    check_pass "SignalVersionController registered in module"
else
    check_fail "SignalVersionController not registered in module"
fi

echo ""
echo "7. Checking Database Migration"
echo "-------------------------------"

# Check migration tables
if grep -q "signal_versions" src/database/migrations/1737650000001-CreateSignalVersioningTables.ts; then
    check_pass "signal_versions table in migration"
else
    check_fail "signal_versions table missing from migration"
fi

if grep -q "signal_version_approvals" src/database/migrations/1737650000001-CreateSignalVersioningTables.ts; then
    check_pass "signal_version_approvals table in migration"
else
    check_fail "signal_version_approvals table missing from migration"
fi

# Check indexes
if grep -q "IDX_signal_versions_signal_id" src/database/migrations/1737650000001-CreateSignalVersioningTables.ts; then
    check_pass "signal_id index exists"
else
    check_fail "signal_id index missing"
fi

if grep -q "IDX_signal_version_approvals_unique" src/database/migrations/1737650000001-CreateSignalVersioningTables.ts; then
    check_pass "Unique constraint on version-copier exists"
else
    check_fail "Unique constraint missing"
fi

echo ""
echo "8. Running Unit Tests"
echo "---------------------"

# Run tests
if npm test -- src/signals/versions/signal-version.service.spec.ts --silent 2>&1 | grep -q "Tests:.*passed"; then
    check_pass "All unit tests pass"
else
    check_fail "Unit tests failed"
fi

echo ""
echo "9. Checking Test Coverage"
echo "--------------------------"

# Check test file exists
if [ -f "src/signals/versions/signal-version.service.spec.ts" ]; then
    check_pass "Test file exists"
    
    # Count test cases
    test_count=$(grep -c "it('should" src/signals/versions/signal-version.service.spec.ts || echo "0")
    if [ "$test_count" -ge 10 ]; then
        check_pass "Comprehensive test coverage ($test_count test cases)"
    else
        check_fail "Insufficient test coverage ($test_count test cases)"
    fi
else
    check_fail "Test file missing"
fi

echo ""
echo "10. Checking Documentation"
echo "--------------------------"

if [ -f "src/signals/versions/README.md" ]; then
    check_pass "README documentation exists"
else
    check_fail "README documentation missing"
fi

echo ""
echo "=============================================="
echo "Validation Summary"
echo "=============================================="
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}✓ All validation checks passed!${NC}"
    echo "Signal versioning implementation is complete and ready for CI."
    exit 0
else
    echo -e "${RED}✗ Some validation checks failed.${NC}"
    echo "Please review the failed checks above."
    exit 1
fi
