# Best Practices

Production-ready patterns and recommendations for building with StellarSwipe API.

## API Key Management

### Environment-Specific Keys

Use different API keys for each environment:

```typescript
// config.ts
export const config = {
  development: {
    apiKey: process.env.STELLARSWIPE_DEV_KEY,
    baseUrl: 'https://api-dev.stellarswipe.com',
  },
  staging: {
    apiKey: process.env.STELLARSWIPE_STAGING_KEY,
    baseUrl: 'https://api-staging.stellarswipe.com',
  },
  production: {
    apiKey: process.env.STELLARSWIPE_PROD_KEY,
    baseUrl: 'https://api.stellarswipe.com',
  },
};

const env = process.env.NODE_ENV || 'development';
const client = new StellarSwipeClient(config[env]);
```

### Secure Storage

✅ **Good**: Environment variables, secret managers

```typescript
// Using environment variables
const apiKey = process.env.STELLARSWIPE_API_KEY;

// Using AWS Secrets Manager
import { SecretsManager } from 'aws-sdk';
const secretsManager = new SecretsManager();
const secret = await secretsManager.getSecretValue({
  SecretId: 'stellarswipe-api-key',
}).promise();

const apiKey = JSON.parse(secret.SecretString).apiKey;
```

❌ **Bad**: Hardcoded, committed to git, client-side

```typescript
// DON'T DO THIS
const apiKey = 'sk_live_abc123xyz';

// DON'T DO THIS
localStorage.setItem('apiKey', 'sk_live_abc123xyz');
```

## Error Handling

### Comprehensive Error Handling

```typescript
import {
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  NetworkError,
  APIError,
} from '@stellarswipe/sdk';

async function executeTrade(tradeData: ExecuteTradeData) {
  try {
    const trade = await client.trades.execute(tradeData);
    return { success: true, trade };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      // Log and alert - this shouldn't happen in production
      logger.error('Authentication failed', { error });
      alertTeam('Invalid API key detected');
      return { success: false, error: 'Authentication failed' };
    }

    if (error instanceof ValidationError) {
      // User error - return friendly message
      logger.warn('Validation error', { error, details: error.details });
      return { success: false, error: error.message, details: error.details };
    }

    if (error instanceof RateLimitError) {
      // Implement backoff
      logger.warn('Rate limited', { retryAfter: error.retryAfter });
      await sleep(error.retryAfter * 1000);
      return executeTrade(tradeData); // Retry
    }

    if (error instanceof NetworkError) {
      // Temporary error - retry with exponential backoff
      logger.warn('Network error', { error });
      return { success: false, error: 'Network error, please retry' };
    }

    if (error instanceof APIError) {
      // Server error
      logger.error('API error', { status: error.status, error });
      return { success: false, error: 'Service temporarily unavailable' };
    }

    // Unexpected error
    logger.error('Unexpected error', { error });
    Sentry.captureException(error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
```

### Retry with Exponential Backoff

The SDK includes automatic retries, but you can customize:

```typescript
const client = new StellarSwipeClient({
  apiKey: process.env.STELLARSWIPE_API_KEY,
  retryOptions: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  },
});
```

## Rate Limiting

### Implement Client-Side Rate Limiting

```typescript
import Bottleneck from 'bottleneck';

// Limit to 1000 requests per hour
const limiter = new Bottleneck({
  reservoir: 1000,
  reservoirRefreshAmount: 1000,
  reservoirRefreshInterval: 60 * 60 * 1000, // 1 hour
  maxConcurrent: 10, // Max 10 concurrent requests
  minTime: 100, // Min 100ms between requests
});

// Wrap client methods
const rateLimitedClient = {
  signals: {
    list: (params) => limiter.schedule(() => client.signals.list(params)),
    get: (id) => limiter.schedule(() => client.signals.get(id)),
  },
  trades: {
    execute: (data) => limiter.schedule(() => client.trades.execute(data)),
    // ... other methods
  },
};
```

### Implement Caching

```typescript
import Redis from 'ioredis';

const redis = new Redis();

async function getSignals(params: SignalListParams) {
  const cacheKey = `signals:${JSON.stringify(params)}`;
  
  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from API
  const signals = await client.signals.list(params);

  // Cache for 1 minute
  await redis.setex(cacheKey, 60, JSON.stringify(signals));

  return signals;
}
```

## Performance

### Batch Requests

```typescript
// ❌ Bad: Multiple sequential requests
for (const signalId of signalIds) {
  const signal = await client.signals.get(signalId);
  signals.push(signal);
}

// ✅ Good: Parallel requests
const signals = await Promise.all(
  signalIds.map(id => client.signals.get(id))
);
```

### Pagination

The backend provides standardized pagination controls for large API responses. When making requests to list endpoints, use the following query parameters:

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

The response will include pagination metadata:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

For cursor-based pagination (used in signal feeds), use `cursor` and `limit` parameters.

```typescript
async function getAllSignals(params: SignalListParams) {
  const allSignals: Signal[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.signals.list({
      ...params,
      cursor,
      limit: 100, // Max per request
    });

    allSignals.push(...response.signals);
    cursor = response.nextCursor;
  } while (cursor);

  return allSignals;
}
```

### Connection Pooling

```typescript
import { Agent } from 'https';

const agent = new Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000,
});

// Use custom fetch with connection pooling
global.fetch = (url, options) => {
  return fetch(url, {
    ...options,
    agent,
  });
};
```

## Data Validation

### Input Validation

```typescript
import Joi from 'joi';

const executeTradeSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  signalId: Joi.string().uuid().required(),
  amount: Joi.number().positive().required(),
  slippage: Joi.number().min(0).max(1).optional(),
});

async function executeTrade(data: unknown) {
  // Validate input
  const { error, value } = executeTradeSchema.validate(data);
  
  if (error) {
    throw new ValidationError('Invalid trade data', error.details);
  }

  // Use validated data
  return client.trades.execute(value);
}
```

### Pre-Trade Validation

Always validate trades before execution:

```typescript
async function safeExecuteTrade(tradeData: ExecuteTradeData) {
  // 1. Validate trade
  const validation = await client.trades.validate(tradeData);

  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
    };
  }

  // 2. Check warnings
  if (validation.warnings && validation.warnings.length > 0) {
    logger.warn('Trade warnings', { warnings: validation.warnings });
  }

  // 3. Check price impact
  if (validation.priceImpact > 5) { // 5% threshold
    logger.warn('High price impact', { impact: validation.priceImpact });
    // Require user confirmation or reject
  }

  // 4. Execute trade
  return client.trades.execute(tradeData);
}
```

## Monitoring and Logging

### Structured Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'stellarswipe-integration' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

// Log all API calls
async function loggedRequest<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    logger.info('API request succeeded', {
      operation,
      duration,
      timestamp: new Date().toISOString(),
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('API request failed', {
      operation,
      duration,
      error: error.message,
      stack: error.stack,
    });
    
    throw error;
  }
}

// Usage
const signals = await loggedRequest(
  'signals.list',
  () => client.signals.list({ limit: 20 })
);
```

### Error Tracking

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// Add context to errors
try {
  await client.trades.execute(tradeData);
} catch (error) {
  Sentry.withScope((scope) => {
    scope.setContext('trade', {
      userId: tradeData.userId,
      signalId: tradeData.signalId,
      amount: tradeData.amount,
    });
    Sentry.captureException(error);
  });
  throw error;
}
```

### Metrics

```typescript
import { Counter, Histogram } from 'prom-client';

const apiRequestsTotal = new Counter({
  name: 'stellarswipe_api_requests_total',
  help: 'Total API requests',
  labelNames: ['method', 'endpoint', 'status'],
});

const apiRequestDuration = new Histogram({
  name: 'stellarswipe_api_request_duration_seconds',
  help: 'API request duration',
  labelNames: ['method', 'endpoint'],
});

async function trackedRequest<T>(
  method: string,
  endpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  const timer = apiRequestDuration.startTimer({ method, endpoint });
  
  try {
    const result = await fn();
    apiRequestsTotal.inc({ method, endpoint, status: 'success' });
    return result;
  } catch (error) {
    apiRequestsTotal.inc({ method, endpoint, status: 'error' });
    throw error;
  } finally {
    timer();
  }
}
```

## Testing

### Unit Tests

```typescript
import { StellarSwipeClient } from '@stellarswipe/sdk';

// Mock the client
jest.mock('@stellarswipe/sdk');

describe('Trading Bot', () => {
  let client: jest.Mocked<StellarSwipeClient>;

  beforeEach(() => {
    client = new StellarSwipeClient('test-key') as any;
  });

  it('should execute trade on high-confidence signal', async () => {
    // Mock signals
    client.signals.list.mockResolvedValue({
      signals: [{
        id: 'sig_1',
        confidence: 85,
        assetPair: 'USDC/XLM',
        action: 'BUY',
      }],
      hasMore: false,
    });

    // Mock validation
    client.trades.validate.mockResolvedValue({
      valid: true,
      estimatedCost: 100,
      estimatedFees: 1,
      priceImpact: 0.5,
    });

    // Mock execution
    client.trades.execute.mockResolvedValue({
      id: 'trade_1',
      status: 'OPEN',
    });

    // Run bot logic
    await bot.checkAndExecuteTrades();

    // Verify
    expect(client.trades.execute).toHaveBeenCalledWith({
      userId: expect.any(String),
      signalId: 'sig_1',
      amount: expect.any(Number),
    });
  });
});
```

### Integration Tests

```typescript
describe('StellarSwipe Integration', () => {
  const client = new StellarSwipeClient(process.env.TEST_API_KEY);

  it('should fetch signals', async () => {
    const signals = await client.signals.list({ limit: 5 });
    expect(signals.signals).toBeInstanceOf(Array);
    expect(signals.signals.length).toBeLessThanOrEqual(5);
  });

  it('should validate trade', async () => {
    const signals = await client.signals.list({ limit: 1 });
    const signal = signals.signals[0];

    const validation = await client.trades.validate({
      userId: 'test-user',
      signalId: signal.id,
      amount: 10,
    });

    expect(validation).toHaveProperty('valid');
    expect(validation).toHaveProperty('estimatedCost');
  });
});
```

## Security

### Input Sanitization

```typescript
import validator from 'validator';
import xss from 'xss';

function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Remove XSS
    return xss(validator.escape(input));
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  }
  
  if (typeof input === 'object' && input !== null) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        sanitizeInput(value),
      ])
    );
  }
  
  return input;
}
```

### Rate Limiting by User

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 requests
  duration: 60, // per minute
});

async function rateLimitedExecute(userId: string, tradeData: ExecuteTradeData) {
  try {
    await rateLimiter.consume(userId);
    return client.trades.execute(tradeData);
  } catch (error) {
    throw new RateLimitError('User rate limit exceeded');
  }
}
```

### Audit Logging

```typescript
interface AuditLog {
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  metadata?: any;
}

async function auditLog(log: AuditLog) {
  await db.auditLogs.create(log);
}

async function executeTrade(userId: string, tradeData: ExecuteTradeData) {
  try {
    const trade = await client.trades.execute(tradeData);
    
    await auditLog({
      timestamp: new Date(),
      userId,
      action: 'EXECUTE_TRADE',
      resource: `trade:${trade.id}`,
      result: 'success',
      metadata: { signalId: tradeData.signalId, amount: tradeData.amount },
    });
    
    return trade;
  } catch (error) {
    await auditLog({
      timestamp: new Date(),
      userId,
      action: 'EXECUTE_TRADE',
      resource: 'trade',
      result: 'failure',
      metadata: { error: error.message },
    });
    
    throw error;
  }
}
```

## Production Checklist

- [ ] API keys stored securely (not in code)
- [ ] Different keys for dev/staging/prod
- [ ] Error handling for all API calls
- [ ] Retry logic with exponential backoff
- [ ] Rate limiting implemented
- [ ] Caching where appropriate
- [ ] Input validation
- [ ] Pre-trade validation
- [ ] Structured logging
- [ ] Error tracking (Sentry, etc.)
- [ ] Metrics and monitoring
- [ ] Unit and integration tests
- [ ] Webhook signature verification
- [ ] HTTPS everywhere
- [ ] Audit logging
- [ ] Security reviews
- [ ] Documentation for team
- [ ] Alerting for critical errors
- [ ] Regular API key rotation
- [ ] Backup and disaster recovery

## Next Steps

- [API Reference](../api-reference/openapi.yaml) - Complete API documentation
- [Code Examples](../examples/) - Production-ready examples
- [Webhooks Guide](./webhooks.md) - Real-time notifications
