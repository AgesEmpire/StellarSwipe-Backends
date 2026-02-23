# Activity Module — Integration Guide

## Logging activities from other services

Inject `ActivityService` into any feature module and call `activityService.log(...)`.

```typescript
// trades.service.ts
import { Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { ActivityType } from '../activity/entities/activity.entity';

@Injectable()
export class TradesService {
  constructor(private readonly activityService: ActivityService) {}

  async executeTrade(userId: string, trade: any) {
    // ... execute trade logic ...

    await this.activityService.log({
      userId,
      type: ActivityType.TRADE_EXECUTED,
      metadata: {
        pair: 'USDC/XLM',
        amount: 1000,
        price: 0.095,
        tradeId: trade.id,
      },
    });
  }
}

// signals.service.ts
await this.activityService.log({
  userId,
  type: ActivityType.SIGNAL_FOLLOWED,
  metadata: {
    signalId: 123,
    signalName: 'Create Partnership and Affiliate Program',
  },
});

// swipe.service.ts
await this.activityService.log({
  userId,
  type: ActivityType.SWIPE_RIGHT,
  metadata: { asset: 'AQUA/XLM', signalId: '...' },
});

// settings.service.ts
await this.activityService.log({
  userId,
  type: ActivityType.UPDATE_SETTINGS,
  metadata: { field: 'notifications', oldValue: false, newValue: true },
});
```

## REST API

### GET /activity/feed

Query params:
- `type` — comma-separated ActivityType values (optional)
- `page` — page number, default 1
- `limit` — items per page, 1–100, default 20

Example:
```
GET /activity/feed?type=TRADE_EXECUTED,SWIPE_RIGHT&page=1&limit=20
Authorization: Bearer <jwt>
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "type": "TRADE_EXECUTED",
      "metadata": { "pair": "USDC/XLM", "amount": 1000, "price": 0.095 },
      "createdAt": "2024-01-15T10:30:00Z",
      "description": "Bought 1000 USDC/XLM at $0.095"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "hasMore": true
}
```

## WebSocket

Connect to `/activity` namespace with socket.io, then subscribe:

```javascript
const socket = io('http://localhost:3000/activity');

socket.on('connect', () => {
  // Send userId (in production, validate via JWT in handshake auth)
  socket.emit('subscribe', { userId: 'your-user-id' });
});

socket.on('activity', (activity) => {
  console.log('New activity:', activity);
  // { id, userId, type, metadata, createdAt, description }
});
```

## AppModule setup

```typescript
import { ActivityModule } from './activity/activity.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ActivityModule,
    // ... other modules
  ],
})
export class AppModule {}
```

## Required packages

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install @nestjs/schedule
npm install @nestjs/typeorm typeorm pg
npm install class-validator class-transformer
npm install @nestjs/swagger swagger-ui-express
```
