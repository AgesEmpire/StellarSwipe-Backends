# Webhooks Guide

Receive real-time notifications when events occur in your StellarSwipe account.

## Overview

Webhooks allow you to receive HTTP POST notifications when specific events occur, such as:

- New signals created
- Trades executed or closed
- Portfolio changes
- Price alerts triggered
- Risk thresholds exceeded

## Setting Up Webhooks

### 1. Create a Webhook Endpoint

Your endpoint must:
- Accept POST requests
- Return a 2xx status code within 5 seconds
- Be publicly accessible over HTTPS

```typescript
import express from 'express';
import { createHmac } from 'crypto';

const app = express();
app.use(express.json());

app.post('/webhooks/stellarswipe', async (req, res) => {
  // Verify signature (see security section)
  if (!verifySignature(req)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  console.log('Received event:', event.type);

  // Process event
  try {
    await handleEvent(event);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Error processing webhook');
  }
});

app.listen(3000);
```

### 2. Register Your Webhook

Register your endpoint in the [Developer Dashboard](https://app.stellarswipe.com/developer/webhooks):

1. Go to Developer Dashboard > Webhooks
2. Click "Add Endpoint"
3. Enter your endpoint URL
4. Select events to subscribe to
5. Copy your webhook secret for signature verification

Or use the API:

```typescript
const webhook = await client.webhooks.create({
  url: 'https://your-domain.com/webhooks/stellarswipe',
  events: ['signal.created', 'trade.executed', 'trade.closed'],
  description: 'Production webhook endpoint',
});

console.log('Webhook ID:', webhook.id);
console.log('Secret:', webhook.secret); // Save this securely
```

## Event Types

### Signal Events

#### `signal.created`
Fired when a new signal is created.

```json
{
  "type": "signal.created",
  "timestamp": "2024-03-24T10:00:00Z",
  "data": {
    "signal": {
      "id": "sig_abc123",
      "providerId": "prov_xyz789",
      "assetPair": "USDC/XLM",
      "action": "BUY",
      "entryPrice": 0.15,
      "confidence": 85,
      "reasoning": "Bullish momentum detected"
    }
  }
}
```

#### `signal.updated`
Fired when a signal is updated.

#### `signal.closed`
Fired when a signal is closed.

### Trade Events

#### `trade.executed`
Fired when a trade is executed.

```json
{
  "type": "trade.executed",
  "timestamp": "2024-03-24T10:05:00Z",
  "data": {
    "trade": {
      "id": "trade_123",
      "userId": "user_456",
      "signalId": "sig_abc123",
      "status": "OPEN",
      "entryPrice": 0.15,
      "amount": 1000,
      "assetPair": "USDC/XLM"
    }
  }
}
```

#### `trade.closed`
Fired when a trade is closed.

```json
{
  "type": "trade.closed",
  "timestamp": "2024-03-24T12:00:00Z",
  "data": {
    "trade": {
      "id": "trade_123",
      "userId": "user_456",
      "status": "CLOSED",
      "entryPrice": 0.15,
      "exitPrice": 0.18,
      "pnl": 200,
      "roi": 20
    }
  }
}
```

#### `trade.partial_close`
Fired when a position is partially closed.

### Portfolio Events

#### `portfolio.rebalanced`
Fired when portfolio rebalancing is executed.

```json
{
  "type": "portfolio.rebalanced",
  "timestamp": "2024-03-24T14:00:00Z",
  "data": {
    "userId": "user_456",
    "planId": "plan_789",
    "tradesExecuted": 5,
    "totalCost": 150.50
  }
}
```

#### `portfolio.drift_detected`
Fired when portfolio drift exceeds threshold.

### Alert Events

#### `alert.price_target`
Fired when a price alert is triggered.

#### `alert.risk_threshold`
Fired when risk thresholds are exceeded.

## Pausing an Endpoint

Pause an endpoint during maintenance without deleting its configuration:

- `POST /webhooks/:id/pause` and `POST /webhooks/:id/resume` (owner only).
- Each transition is recorded in an immutable audit log (`webhook_state_audits`).
- While paused, events are still recorded but not sent. They are stored as
  deliveries with status `paused` and make no HTTP attempts and no retries.
  Pausing does not count toward the consecutive-failure disable threshold.
- Held events are retained for 72 hours. On resume, held events younger than
  that are queued for normal delivery; older ones are marked `expired` and are
  not sent.
- Manual retry of a delivery to a paused endpoint is rejected until it is resumed.
- Mandatory security notifications (secret rotation) are also held while paused.

## Handling Webhooks

### Basic Event Handler

```typescript
async function handleEvent(event: WebhookEvent) {
  switch (event.type) {
    case 'signal.created':
      await handleSignalCreated(event.data.signal);
      break;
    
    case 'trade.executed':
      await handleTradeExecuted(event.data.trade);
      break;
    
    case 'trade.closed':
      await handleTradeClosed(event.data.trade);
      break;
    
    case 'portfolio.rebalanced':
      await handlePortfolioRebalanced(event.data);
      break;
    
    default:
      console.log('Unhandled event type:', event.type);
  }
}
```

### Example: Auto-Trade on Signal

```typescript
async function handleSignalCreated(signal: Signal) {
  // Only auto-trade on high-confidence signals
  if (signal.confidence < 80) {
    return;
  }

  // Get your user configuration
  const config = await getAutoTradeConfig();
  
  if (!config.enabled) {
    return;
  }

  // Execute trade
  try {
    const trade = await client.trades.execute({
      userId: config.userId,
      signalId: signal.id,
      amount: config.defaultAmount,
    });

    console.log(`Auto-trade executed: ${trade.id}`);
    
    // Send notification
    await sendNotification({
      title: 'Auto-Trade Executed',
      message: `${signal.assetPair} ${signal.action} at ${signal.entryPrice}`,
    });
  } catch (error) {
    console.error('Auto-trade failed:', error);
  }
}
```

### Example: Performance Monitoring

```typescript
async function handleTradeClosed(trade: Trade) {
  // Log performance
  await logTradePerformance(trade);

  // Send notification for significant P&L
  if (Math.abs(trade.pnl) > 100) {
    await sendNotification({
      title: 'Significant Trade Closed',
      message: `P&L: $${trade.pnl} (ROI: ${trade.roi}%)`,
      priority: 'high',
    });
  }

  // Update dashboard
  await updateTradingDashboard();

  // Check if portfolio rebalancing needed
  const drift = await client.portfolio.analyzeDrift(trade.userId);
  if (drift.requiresRebalancing) {
    await client.portfolio.createRebalancingPlan(trade.userId);
  }
}
```

## Security

### Signature Verification

Always verify webhook signatures to ensure requests are from StellarSwipe:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Use timing-safe comparison
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  
  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }
  
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

function verifySignature(req: express.Request): boolean {
  const signature = req.headers['x-stellarswipe-signature'] as string;
  const timestamp = req.headers['x-stellarswipe-timestamp'] as string;
  
  if (!signature || !timestamp) {
    return false;
  }

  // Reject old requests (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  
  if (Math.abs(currentTime - requestTime) > 300) { // 5 minutes
    return false;
  }

  // Verify signature
  const payload = timestamp + '.' + JSON.stringify(req.body);
  return verifyWebhookSignature(
    payload,
    signature,
    process.env.WEBHOOK_SECRET
  );
}
```

### Security Best Practices

1. **Always verify signatures** - Never process unverified webhooks
2. **Use HTTPS** - Webhook endpoints must use HTTPS in production
3. **Check timestamps** - Reject old requests to prevent replay attacks
4. **Validate payloads** - Verify event structure before processing
5. **Rate limit** - Implement rate limiting on your endpoint
6. **Use secrets securely** - Store webhook secrets in environment variables

## Reliability

### Retry Logic

StellarSwipe automatically retries failed webhooks:

- Retries up to 3 times with exponential backoff
- Initial retry after 5 seconds
- Maximum delay of 5 minutes
- Stops retrying after 24 hours

### Idempotency

Handle duplicate events gracefully:

```typescript
const processedEvents = new Set<string>();

async function handleEvent(event: WebhookEvent) {
  // Check if already processed
  const eventId = event.id;
  
  if (processedEvents.has(eventId)) {
    console.log('Event already processed:', eventId);
    return;
  }

  // Process event
  await processEventLogic(event);

  // Mark as processed
  processedEvents.add(eventId);
  
  // Store in database for persistence
  await db.webhookEvents.create({
    id: eventId,
    type: event.type,
    processedAt: new Date(),
  });
}
```

### Error Handling

```typescript
app.post('/webhooks/stellarswipe', async (req, res) => {
  try {
    // Verify signature first
    if (!verifySignature(req)) {
      return res.status(401).send('Invalid signature');
    }

    // Acknowledge receipt immediately
    res.status(200).send('OK');

    // Process asynchronously
    handleEvent(req.body).catch(error => {
      console.error('Error processing webhook:', error);
      // Log to error tracking service
      Sentry.captureException(error);
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal error');
  }
});
```

## Testing Webhooks

### Local Testing with ngrok

```bash
# Start ngrok
ngrok http 3000

# Use the ngrok URL in your webhook configuration
# https://abc123.ngrok.io/webhooks/stellarswipe
```

### Test Events

Trigger test events from the Developer Dashboard:

```typescript
// Or via API
await client.webhooks.test('webhook_id', 'signal.created');
```

### Mock Events

```typescript
const mockEvent = {
  id: 'evt_test_123',
  type: 'trade.executed',
  timestamp: new Date().toISOString(),
  data: {
    trade: {
      id: 'trade_test',
      userId: 'user_test',
      signalId: 'sig_test',
      status: 'OPEN',
      entryPrice: 0.15,
      amount: 1000,
    },
  },
};

await handleEvent(mockEvent);
```

## Monitoring

### Webhook Dashboard

Monitor webhook delivery in the Developer Dashboard:

- Delivery success rate
- Recent deliveries and failures
- Response times
- Error logs

### Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'webhooks.log' }),
  ],
});

app.post('/webhooks/stellarswipe', async (req, res) => {
  logger.info('Webhook received', {
    type: req.body.type,
    id: req.body.id,
    timestamp: req.body.timestamp,
  });

  // Process webhook...
});
```

## Next Steps

- [Best Practices](./best-practices.md) - Production-ready patterns
- [API Reference](../api-reference/openapi.yaml) - Complete API documentation
- [Code Examples](../examples/) - More webhook examples
