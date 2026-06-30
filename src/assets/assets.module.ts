import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { Asset } from './entities/asset.entity';
import { AssetPair } from './entities/asset-pair.entity';
import { AssetFreeze } from './freeze/entities/asset-freeze.entity';
import { PlatformTrustline } from './entities/platform-trustline.entity';
import { AssetFreezeService } from './freeze/asset-freeze.service';
import { AssetController } from './freeze/asset.controller';
import { TrustlineEstablishmentService } from './trustline-establishment.service';
import { OrphanedTrustlineScanJob } from './jobs/orphaned-trustline-scan.job';
import { OrphanedTrustlineReportController } from './jobs/orphaned-trustline-report.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, AssetPair, AssetFreeze, PlatformTrustline]),
    CacheModule.register({
      ttl: 60 * 1000, // 60 seconds default TTL
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [AssetsService, AssetFreezeService, TrustlineEstablishmentService, OrphanedTrustlineScanJob],
  controllers: [AssetsController, AssetController, OrphanedTrustlineReportController],
  exports: [AssetsService, AssetFreezeService, TrustlineEstablishmentService],
})
export class AssetsModule {}
