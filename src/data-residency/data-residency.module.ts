import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataRegion } from './entities/data-region.entity';
import { ResidencyPolicy } from './entities/residency-policy.entity';
import { ResidencyManagerService } from './residency-manager.service';
import { RegionRouterService } from './services/region-router.service';
import { DataMigratorService } from './services/data-migrator.service';
import { ComplianceValidatorService } from './services/compliance-validator.service';
import { EuStorageStrategy } from './strategies/eu-storage.strategy';
import { UsStorageStrategy } from './strategies/us-storage.strategy';
import { AsiaStorageStrategy } from './strategies/asia-storage.strategy';
import { RegionDetector } from './utils/region-detector';
import { DataLocalizer } from './utils/data-localizer';

@Module({
  imports: [TypeOrmModule.forFeature([DataRegion, ResidencyPolicy])],
  providers: [
    ResidencyManagerService,
    RegionRouterService,
    DataMigratorService,
    ComplianceValidatorService,
    EuStorageStrategy,
    UsStorageStrategy,
    AsiaStorageStrategy,
    RegionDetector,
    DataLocalizer,
  ],
  exports: [ResidencyManagerService, RegionDetector],
})
export class DataResidencyModule {}
