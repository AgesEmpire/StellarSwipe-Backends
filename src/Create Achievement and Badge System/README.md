# Achievement System – NestJS Implementation

## Overview

A fully event-driven gamification module. When a domain event fires (`trade.executed`, `signal.created`, etc.) the listener evaluates every relevant achievement and, if the threshold is met, awards the badge exactly once and emits an `achievement.awarded` notification event.

---

## Folder Structure

```
src/achievements/
├── achievements.module.ts          # NestJS module wiring
├── achievements.service.ts         # Core logic: evaluation, awarding, progress
├── achievements.controller.ts      # REST API (profile, catalogue, retroactive)
├── entities/
│   ├── achievement.entity.ts       # Badge definition (key, criteria, rarity)
│   └── user-achievement.entity.ts  # Per-user progress / award record
├── listeners/
│   └── achievement-event.listener.ts  # Domain event → service delegation
└── dto/
    └── user-achievements.dto.ts    # Request/response shapes + event payloads
```

---

## Setup

### 1. Root AppModule

```ts
// app.module.ts
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AchievementsModule } from './achievements/achievements.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),   // ← required once at root
    AchievementsModule,
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. TypeORM entities

Add `Achievement` and `UserAchievement` to your TypeORM entity list or use
`autoLoadEntities: true` in `TypeOrmModule.forRoot()`.

---

## Emitting Events (from other modules)

```ts
// trades.service.ts
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class TradesService {
  constructor(private eventEmitter: EventEmitter2) {}

  async executeTrade(userId: string, ...) {
    // ... business logic ...

    this.eventEmitter.emit('trade.executed', {
      userId,
      tradeId: trade.id,
      profit: trade.profit,      // positive = win
      holdDays: trade.holdDays,  // optional
    });
  }
}
```

Similarly emit:
- `signal.created` → `{ userId, signalId }`
- `signal.copied` → `{ providerId, signalId, totalCopies }`
- `trade.month_closed` → `{ userId, netProfit }` (from a scheduler)

---

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/achievements` | All badge definitions |
| `GET` | `/achievements/me` | Current user's badges + progress |
| `GET` | `/achievements/users/:userId` | Another user's public badge collection |
| `POST` | `/achievements/users/:userId/retroactive` | Admin: award past badges based on metrics |

### Retroactive body example

```json
{
  "tradeCount": 42,
  "winStreak": 6,
  "signalCount": 3,
  "signalCopies": 150,
  "maxHoldDays": 35,
  "profitableMonth": true
}
```

---

## Achievements Catalogue

| Key | Name | Criteria | Rarity |
|-----|------|----------|--------|
| `first_trade` | First Swipe | 1 trade | common |
| `ten_trades` | Getting Started | 10 trades | common |
| `hot_streak` | Hot Streak | 5-win streak | rare |
| `provider` | Provider | 1 signal created | common |
| `popular` | Popular | 100 signal copies | epic |
| `diamond_hands` | Diamond Hands | hold > 30 days | legendary |
| `profitable_month` | Green Month | net-positive calendar month | rare |

New achievements can be added without code changes by inserting rows into the `achievements` table; the seeder handles initial data.

---

## Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Duplicate badge award | `UNIQUE(userId, achievementId)` DB constraint + pre-check in service |
| Race-condition double-insert | Catches `23505` PostgreSQL unique-violation code |
| Exactly-at-threshold (e.g. exactly 5 trades) | `currentValue >= threshold` (inclusive) |
| Retroactive awards | `POST /achievements/users/:id/retroactive` endpoint |
| Achievement added after users exist | `ensureProgressRows()` lazily creates rows on profile load |

---

## Notifications

The `achievement.awarded` event is emitted every time a badge is granted.
Wire your `NotificationsService` inside `AchievementEventListener.onAchievementAwarded()`.

```ts
@OnEvent('achievement.awarded', { async: true })
async onAchievementAwarded(payload) {
  await this.notificationsService.send({
    userId:   payload.userId,
    title:    `Badge Earned: ${payload.achievement.name}`,
    body:     `You unlocked a ${payload.achievement.rarity} badge! 🏅`,
    imageUrl: payload.achievement.badgeImage,
    type:     'achievement',
  });
}
```

---

## Production Notes

- **Win-streak tracking** is currently in-memory. Replace `winStreaks` Map with Redis `INCR`/`SET` for multi-instance deployments.
- **Metric counters** (`trade_count`, `signal_count`) are similarly in-memory; persist them in Redis or a dedicated `user_metrics` table.
- Wrap `evaluateAchievement` + `awardBadge` in a DB transaction for strict consistency.
