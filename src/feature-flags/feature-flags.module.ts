import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagAssignment } from './entities/flag-assignment.entity';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeatureFlag, FlagAssignment]),
    CacheModule.register(),
  ],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
