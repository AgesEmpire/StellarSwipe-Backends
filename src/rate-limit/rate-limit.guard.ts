// Re-exports the canonical rate-limit guard from common/guards.
// Issue #372: API gateway rate limiting entry point.
export { RateLimitGuard } from '../common/guards/rate-limit.guard';
export { RateLimitTier, RateLimit, RateLimitConfig, RATE_LIMIT_KEY } from '../common/decorators/rate-limit.decorator';
