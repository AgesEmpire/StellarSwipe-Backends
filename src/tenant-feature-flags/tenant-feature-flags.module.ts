import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantFeatureFlagsService } from './tenant-feature-flags.service';
import { TenantFeatureFlagsController } from './tenant-feature-flags.controller';

@Module({
  imports: [ConfigModule],
  controllers: [TenantFeatureFlagsController],
  providers: [TenantFeatureFlagsService],
  exports: [TenantFeatureFlagsService],
})
export class TenantFeatureFlagsModule {}
