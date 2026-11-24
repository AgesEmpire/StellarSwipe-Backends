import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';
import { UserProviderMute } from '../providers/entities/user-provider-mute.entity';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { FeedAnalyticsService } from './feed-analytics.service';
import { FeedRankingService } from './feed-ranking.service';
import { AssetPairMetadataService } from './asset-pair-metadata.service';
import { ProviderMuteService } from '../providers/mute/provider-mute.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { UserSignalCategoryPreference } from './category-mutes/user-signal-category-preference.entity';
import { SignalCategoryMuteService } from './category-mutes/signal-category-mute.service';
import { SignalCategoryMuteController } from './category-mutes/signal-category-mute.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, ProviderStats, UserProviderMute, UserSignalCategoryPreference]),
    CacheModule.register({ ttl: 30 }),
    AnalyticsModule,
  ],
  controllers: [SignalsController, SignalCategoryMuteController],
  providers: [
    SignalsService,
    FeedAnalyticsService,
    FeedRankingService,
    AssetPairMetadataService,
    ProviderMuteService,
    SignalCategoryMuteService,
  ],
  exports: [SignalCategoryMuteService, SignalsService, FeedRankingService, AssetPairMetadataService],
})
export class SignalsModule {}
