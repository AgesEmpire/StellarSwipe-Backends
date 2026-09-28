import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  RevenueShareTier,
  ProviderRevenuePayout,
  ProviderTierAssignment,
} from './revenue-share/entities/revenue-share-tier.entity';

import { RevenueShareService } from './revenue-share/revenue-share.service';
import { TierManagerService } from './revenue-share/tier-manager.service';
import { ProvidersController } from './providers.controller';
import { ProviderAnalyticsController } from './analytics/provider-analytics.controller';
import { ProviderAnalyticsService } from './analytics/provider-analytics.service';
import { HealthScoreController } from './health-score/health-score.controller';
import { ProviderHealthScoreService } from './health-score/provider-health-score.service';

import { ProviderStats } from '../signals/entities/provider-stats.entity';
import { Signal } from '../signals/entities/signal.entity';
import { Trade } from '../trades/entities/trade.entity';
import { ProviderEarning } from '../provider-rewards/provider-earning.entity';
import { User } from '../users/entities/user.entity';
import { UserProviderMute } from './entities/user-provider-mute.entity';
import { ProviderMuteService } from './mute/provider-mute.service';
import { ReputationSyncJob } from './jobs/reputation-sync.job';
import { SorobanModule } from '../soroban/soroban.module';
import { AlertsModule } from '../monitoring/alerts/alerts.module';

@Module({
  imports: [
    SorobanModule,
    AlertsModule,
    TypeOrmModule.forFeature([
      RevenueShareTier,
      ProviderRevenuePayout,
      ProviderTierAssignment,
      ProviderStats,
      Signal,
      Trade,
      ProviderEarning,
      User,
      UserProviderMute,
    ]),
  ],
  controllers: [ProvidersController, ProviderAnalyticsController, HealthScoreController],
  providers: [
    RevenueShareService,
    TierManagerService,
    ProviderAnalyticsService,
    ProviderHealthScoreService,
    ReputationSyncJob,
  ],
  exports: [
    RevenueShareService,
    TierManagerService,
    ProviderAnalyticsService,
    ProviderHealthScoreService,
    ReputationSyncJob,
  ],
})
export class ProvidersModule {}
