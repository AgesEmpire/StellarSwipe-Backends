import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegionalComplianceService } from './regional-compliance.service';
import { RegionalComplianceController } from './compliance.controller';
import { ComplianceCheck } from './entities/compliance-check.entity';
import { RegionalRule } from './entities/regional-rule.entity';
import { EuGdprFramework } from './frameworks/eu-gdpr.framework';
import { UsFinraFramework } from './frameworks/us-finra.framework';
import { NigeriaSecFramework } from './frameworks/nigeria-sec.framework';
import { RegionDetector } from './utils/region-detector';
import { RuleEngine } from './utils/rule-engine';

@Module({
  imports: [TypeOrmModule.forFeature([ComplianceCheck, RegionalRule])],
  providers: [
    RegionalComplianceService,
    EuGdprFramework,
    UsFinraFramework,
    NigeriaSecFramework,
    RegionDetector,
    RuleEngine,
  ],
  controllers: [RegionalComplianceController],
  exports: [RegionalComplianceService, RegionDetector],
})
export class RegionalComplianceModule {}
