# Max Call Depth Enforcement for Soroban Cross-Contract Calls

## Overview
This PR implements a decorator-based system for enforcing maximum Soroban cross-contract call depth per trade-related endpoint, addressing issue #794.

## Problem Statement
Trade execution can involve cross-contract calls (e.g., trade_executor calling fee_collector and stake_vault). There was no declared, enforced expectation per endpoint of the maximum acceptable call depth, risking unnoticed regressions that add unexpectedly deep call chains and budget risk.

## Solution
Added a decorator system that:
1. Declares the expected maximum cross-contract call depth for a given endpoint
2. Extracts and validates actual call depth from Soroban transaction simulation responses
3. Rejects or warns (configurable) when the simulated call depth exceeds the declared maximum

## Features Implemented

### 1. MaxCallDepth Decorator (`src/common/decorators/max-call-depth.decorator.ts`)
- `@MaxCallDepth({ maxDepth: number, endpoint?: string, onViolation?: 'reject' | 'warn' })` decorator
- Declares the maximum allowed cross-contract call depth for an endpoint
- Supports per-endpoint configuration and violation policy

### 2. MaxCallDepthGuard (`src/common/guards/max-call-depth.guard.ts`)
- Validates call depth from request metadata
- Throws `ConflictException` (409) when depth exceeds maximum in reject mode
- Logs warning but allows request in warn mode
- Gracefully handles missing call depth data

### 3. MaxCallDepthService (`src/common/services/max-call-depth.service.ts`)
- Extracts call depth from Soroban simulation responses
- Parses auth entries to calculate maximum nesting depth of `subInvocations`
- Falls back to footprint-based estimation when auth entries unavailable
- Validates depth against declared maximum with configurable policy

### 4. Environment Configuration
- `STELLAR_MAX_CALL_DEPTH` - Default maximum call depth (default: 5)
- `STELLAR_MAX_CALL_DEPTH_POLICY` - Global violation policy: 'reject' or 'warn'

## Files Changed

### New Files
- `src/common/decorators/max-call-depth.decorator.ts`
- `src/common/guards/max-call-depth.guard.ts`
- `src/common/guards/max-call-depth.guard.spec.ts`
- `src/common/services/max-call-depth.service.ts`
- `src/common/services/max-call-depth.service.spec.ts`
- `src/common/max-call-depth.module.ts`

### Modified Files
- `src/common/decorators/index.ts` - Added MaxCallDepth exports
- `src/app.module.ts` - Imported MaxCallDepthModule
- `src/config/stellar.config.ts` - Added maxCallDepth and maxCallDepthViolationPolicy
- `src/config/stellar.service.ts` - Added getters for maxCallDepth config
- `src/config/schemas/config.interface.ts` - Extended StellarConfig interface
- `src/soroban/soroban.service.ts` - Integrated MaxCallDepthService validation
- `src/soroban/soroban.module.ts` - Added MaxCallDepthModule import
- `src/trades/trades.controller.ts` - Applied @MaxCallDepth decorator to endpoints
- `.env.example` - Added STELLAR_MAX_CALL_DEPTH and STELLAR_MAX_CALL_DEPTH_POLICY

## Endpoint Coverage

### Trades Controller
- `POST /trades/execute` - Max depth: 5 (cross-contract calls to trade_executor, fee_collector, stake_vault)
- `POST /trades/close` - Max depth: 3 (simpler close operation)
- `POST /trades/validate` - No decorator (validation only, no contract calls)
- `POST /trades/partial-close` - No decorator (delegated to partial-close service)

## Testing

### Unit Tests
- `max-call-depth.guard.spec.ts` - Tests guard behavior for various scenarios
- `max-call-depth.service.spec.ts` - Tests depth extraction and validation

Test coverage includes:
- Depth extraction from auth entries with nested subInvocations
- Footprint-based depth estimation fallback
- Validation within/above/below declared maximum
- Warn mode vs reject mode behavior
- Configuration fallback to defaults

## Usage Example

```typescript
// In trades.controller.ts
@Post('execute')
@UseGuards(MaxCallDepthGuard)
@MaxCallDepth({ maxDepth: 5, endpoint: 'execute-trade', onViolation: 'reject' })
async executeTrade(@Body() dto: ExecuteTradeDto): Promise<TradeResultDto> {
  return this.commandBus.execute(new ExecuteTradeCommand(dto));
}
```

## Environment Variables

```bash
# Maximum cross-contract call depth (default: 5)
STELLAR_MAX_CALL_DEPTH=5

# Violation policy: 'reject' (throw 409) or 'warn' (log only)
STELLAR_MAX_CALL_DEPTH_POLICY=reject
```

## Acceptance Criteria Checklist
- [x] Add a decorator declaring the expected maximum cross-contract call depth for a given trade-related endpoint
- [x] Verify the actual call depth from the transaction simulation result against the declared maximum before submission
- [x] Reject or warn (configurable) when the simulated call depth exceeds the declared maximum
- [x] Add unit tests covering simulated results at, below, and above the declared maximum depth

## Closes #794