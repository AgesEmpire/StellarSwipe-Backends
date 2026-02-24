# Contests Quick Start Guide

## Setup

1. **Run Migration**
```bash
npm run migration:run
```

2. **Import Module**
The ContestsModule is already registered in `app.module.ts`.

## Usage Examples

### Create a Contest

```typescript
import { ContestsService } from './contests/contests.service';
import { ContestMetric } from './contests/entities/contest.entity';

// Inject service
constructor(private readonly contestsService: ContestsService) {}

// Create weekly ROI contest
const contest = await this.contestsService.createContest({
  name: 'Weekly Highest ROI Challenge',
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-08T00:00:00Z',
  metric: ContestMetric.HIGHEST_ROI,
  minSignals: 3,
  prizePool: '1000.00000000',
});
```

### Get Active Contests

```typescript
const activeContests = await this.contestsService.getActiveContests();
```

### View Leaderboard

```typescript
const leaderboard = await this.contestsService.getContestLeaderboard(contestId);

console.log('Contest:', leaderboard.contestName);
console.log('Top Provider:', leaderboard.entries[0].provider);
console.log('Score:', leaderboard.entries[0].score);
```

### Finalize Contest

```typescript
// After contest end time
const result = await this.contestsService.finalizeContest(contestId);

console.log('Winners:', result.winners);
console.log('Prizes:', result.prizes);
```

## API Examples

### Create Contest via API

```bash
curl -X POST http://localhost:3000/api/v1/contests \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monthly Success Rate Contest",
    "startTime": "2024-02-01T00:00:00Z",
    "endTime": "2024-03-01T00:00:00Z",
    "metric": "BEST_SUCCESS_RATE",
    "minSignals": 5,
    "prizePool": "5000"
  }'
```

### Get Leaderboard

```bash
curl http://localhost:3000/api/v1/contests/{contestId}/leaderboard
```

### Finalize Contest

```bash
curl -X POST http://localhost:3000/api/v1/contests/{contestId}/finalize
```

## Testing

### Run Unit Tests
```bash
npm test -- contests.service.spec.ts
npm test -- contests.controller.spec.ts
```

### Run Integration Tests
```bash
npm test -- contests.integration.spec.ts
```

## Contest Metrics

| Metric | Description | Use Case |
|--------|-------------|----------|
| HIGHEST_ROI | Total return on investment | Reward best performing signals |
| BEST_SUCCESS_RATE | Percentage of profitable signals | Reward consistency |
| MOST_VOLUME | Total copied volume | Reward popular signals |
| MOST_FOLLOWERS | Follower count | Reward community engagement |

## Automatic Enrollment

Providers are automatically entered when they submit signals during the contest period. No registration needed!

```typescript
// Provider submits signal during contest
await signalsService.create({
  providerId: 'provider-123',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  // ... other fields
});

// Provider is now automatically in all active contests
```

## Prize Distribution

- **1st Place**: 50% of prize pool
- **2nd Place**: 30% of prize pool  
- **3rd Place**: 20% of prize pool

Example with 1000 prize pool:
- Winner 1: 500
- Winner 2: 300
- Winner 3: 200

## Common Patterns

### Weekly Recurring Contest

```typescript
// Create every Monday
const startOfWeek = new Date();
startOfWeek.setHours(0, 0, 0, 0);

const endOfWeek = new Date(startOfWeek);
endOfWeek.setDate(endOfWeek.getDate() + 7);

await contestsService.createContest({
  name: `Weekly ROI - Week ${weekNumber}`,
  startTime: startOfWeek.toISOString(),
  endTime: endOfWeek.toISOString(),
  metric: ContestMetric.HIGHEST_ROI,
  minSignals: 3,
  prizePool: '1000',
});
```

### Auto-Finalize with Cron

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';

@Cron(CronExpression.EVERY_HOUR)
async autoFinalizeContests() {
  const now = new Date();
  const contests = await this.contestsService.getAllContests(
    ContestStatus.ACTIVE
  );

  for (const contest of contests) {
    if (contest.endTime <= now) {
      try {
        await this.contestsService.finalizeContest(contest.id);
        console.log(`Finalized contest: ${contest.name}`);
      } catch (error) {
        console.error(`Failed to finalize ${contest.id}:`, error);
      }
    }
  }
}
```

## Troubleshooting

### Contest Not Finalizing
- Check that current time is after `endTime`
- Verify contest status is `ACTIVE`
- Ensure at least one provider meets `minSignals` requirement

### No Winners Selected
- Check if any providers submitted enough signals
- Verify signals are in `CLOSED` status
- Confirm signals were created within contest time window

### Incorrect Scores
- Verify signal `closePrice` is set
- Check that `totalProfitLoss` is calculated
- Ensure signals have `CLOSED` status

## Best Practices

1. **Set Realistic Minimums**: Don't set `minSignals` too high
2. **Clear Naming**: Use descriptive contest names with dates
3. **Appropriate Duration**: Weekly/monthly works best
4. **Fair Prize Pools**: Scale prizes with expected participation
5. **Monitor Active Contests**: Don't create overlapping contests with same metric

## Support

For issues or questions:
- Check the [README](./README.md) for detailed documentation
- Review [Implementation Checklist](./IMPLEMENTATION_CHECKLIST.md)
- Run tests to verify setup
