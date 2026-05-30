import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { Asset } from './entities/asset.entity';
import { AssetPair } from './entities/asset-pair.entity';
import { AssetFreeze } from './freeze/entities/asset-freeze.entity';
import { AssetFreezeService } from './freeze/asset-freeze.service';
import { AssetController } from './freeze/asset.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Asset, AssetPair, AssetFreeze]),
    CacheModule.register({
      ttl: 60 * 1000, // 60 seconds default TTL
    }),
  ],
  providers: [AssetsService, AssetFreezeService],
  controllers: [AssetsController, AssetController],
  exports: [AssetsService, AssetFreezeService],
})
export class AssetsModule {}
