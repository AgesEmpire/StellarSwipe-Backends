import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderStats } from '../signals/entities/provider-stats.entity';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { FeedAnalyticsService } from './feed-analytics.service';
import { FeedRankingService } from './feed-ranking.service';
import { AssetPairMetadataService } from './asset-pair-metadata.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal, ProviderStats]),
    CacheModule.register({ ttl: 30 }),
    AnalyticsModule,
  ],
  controllers: [SignalsController],
  providers: [
    SignalsService,
    FeedAnalyticsService,
    FeedRankingService,
    AssetPairMetadataService,
  ],
  exports: [SignalsService, FeedRankingService, AssetPairMetadataService],
})
export class SignalsModule {}
