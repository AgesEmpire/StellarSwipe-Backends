import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagAssignment } from './entities/flag-assignment.entity';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { ValidateFeatureFlagEntrypointsJob } from './jobs/validate-feature-flag-entrypoints.job';
import { TenantConfigService } from '../config/tenant-config.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([FeatureFlag, FlagAssignment]),
    CacheModule.register(),
    ScheduleModule,
  ],
  controllers: [FeatureFlagsController],
  providers: [
    FeatureFlagsService,
    FeatureFlagGuard,
    ValidateFeatureFlagEntrypointsJob,
    // #943 — tenant-aware feature flag overrides, consulted by FeatureFlagsService.
    TenantConfigService,
  ],
  exports: [FeatureFlagsService, FeatureFlagGuard, TenantConfigService],
})
export class FeatureFlagsModule {}
