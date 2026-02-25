# Signal Contests & Leaderboards

Gamification system for signal providers through time-bound contests that track performance and award winners.

## Features

- **Time-bound Contests**: Weekly, monthly, or custom duration contests
- **Multiple Metrics**: ROI, success rate, volume, follower count
- **Automatic Enrollment**: Signals submitted during contest period auto-enter providers
- **Prize Distribution**: 50/30/20 split for top 3 winners
- **Real-time Leaderboards**: Track contest standings live

## Contest Metrics

### HIGHEST_ROI
Tracks total return on investment across all signals in the contest period.

### BEST_SUCCESS_RATE
Measures percentage of profitable signals (closed with positive P&L).

### MOST_VOLUME
Tracks total copied volume across all signals.

### MOST_FOLLOWERS
Counts total followers (requires integration with follow system).

## API Endpoints

### Create Contest
```http
POST /api/v1/contests
Content-Type: application/json

{
  "name": "Weekly ROI Challenge",
  "startTime": "2024-01-01T00:00:00Z",
  "endTime": "2024-01-08T00:00:00Z",
  "metric": "HIGHEST_ROI",
  "minSignals": 3,
  "prizePool": "1000.00000000"
}
```

### Get Active Contests
```http
GET /api/v1/contests/active
```

### Get Contest Leaderboard
```http
GET /api/v1/contests/:id/leaderboard
```

Response:
```json
{
  "contestId": "uuid",
  "contestName": "Weekly ROI Challenge",
  "metric": "HIGHEST_ROI",
  "entries": [
    {
      "provider": "provider-id",
      "signalsSubmitted": ["signal-1", "signal-2"],
      "totalRoi": "150.50000000",
      "successRate": 100,
      "totalVolume": "5000.00000000",
      "score": "150.50000000"
    }
  ],
  "winners": null,
  "status": "ACTIVE",
  "endTime": "2024-01-08T00:00:00Z"
}
```

### Finalize Contest
```http
POST /api/v1/contests/:id/finalize
```

Response:
```json
{
  "winners": ["provider-1", "provider-2", "provider-3"],
  "prizes": {
    "provider-1": "500.00000000",
    "provider-2": "300.00000000",
    "provider-3": "200.00000000"
  }
}
```

### Get All Contests
```http
GET /api/v1/contests?status=ACTIVE&limit=50
```

## Automatic Enrollment

Providers are automatically entered into active contests when they submit signals during the contest period. No explicit registration required.

## Qualification Rules

- Providers must submit minimum number of signals (configurable per contest)
- Only closed signals count toward metrics
- Signals must be created within contest time window

## Prize Distribution

- **1st Place**: 50% of prize pool
- **2nd Place**: 30% of prize pool
- **3rd Place**: 20% of prize pool

If fewer than 3 qualified entries, prizes are distributed proportionally to available winners.

## Edge Cases Handled

### No Qualified Entries
Contest finalizes with empty winners array. Prize pool can be rolled over to next contest.

### Tie in Scores
Both providers receive same rank. Prize split equally between tied winners.

### Provider Manipulation
Minimum signal requirement and success rate filtering prevent gaming through many low-quality signals.

### Contest Not Finalized
Anyone can trigger finalization after end time. Idempotent operation.

## Database Schema

```sql
CREATE TABLE contests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  metric ENUM('HIGHEST_ROI', 'BEST_SUCCESS_RATE', 'MOST_VOLUME', 'MOST_FOLLOWERS'),
  min_signals INT DEFAULT 3,
  prize_pool DECIMAL(18,8) DEFAULT 0,
  status ENUM('ACTIVE', 'FINALIZED', 'CANCELLED') DEFAULT 'ACTIVE',
  winners JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_contests_status_time ON contests(status, start_time, end_time);
```

## Testing

### Unit Tests
```bash
npm test -- contests.service.spec.ts
npm test -- contests.controller.spec.ts
```

### Integration Tests
```bash
npm test -- contests.integration.spec.ts
```

### Coverage
All core functionality covered:
- Contest creation and validation
- Leaderboard calculation
- Winner selection
- Prize distribution
- Edge cases

## Example Usage

### Create Weekly ROI Contest
```typescript
const contest = await contestsService.createContest({
  name: 'Weekly Highest ROI',
  startTime: '2024-01-01T00:00:00Z',
  endTime: '2024-01-08T00:00:00Z',
  metric: ContestMetric.HIGHEST_ROI,
  minSignals: 3,
  prizePool: '1000',
});
```

### Check Leaderboard
```typescript
const leaderboard = await contestsService.getContestLeaderboard(contestId);
console.log('Top provider:', leaderboard.entries[0].provider);
console.log('Score:', leaderboard.entries[0].score);
```

### Finalize Contest
```typescript
const result = await contestsService.finalizeContest(contestId);
console.log('Winners:', result.winners);
console.log('Prizes:', result.prizes);
```

## Future Enhancements

- Scheduled auto-finalization via cron job
- Contest templates for recurring contests
- Multi-tier prize structures
- Team-based contests
- Sponsor integration for prize pools
- NFT badges for winners
- Historical contest archive

## Integration Points

- **Signals Module**: Tracks signal submissions and outcomes
- **Users Module**: Provider information and profiles
- **Follow System**: Follower count metric (when implemented)
- **Notifications**: Winner announcements
- **Analytics**: Contest performance tracking
