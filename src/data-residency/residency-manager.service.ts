import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataRegion, RegionCode, RegionStatus } from './entities/data-region.entity';
import { ResidencyPolicy, PolicyStatus } from './entities/residency-policy.entity';
import { RegionRouterService, RoutingDecision } from './services/region-router.service';
import { DataMigratorService, MigrationJob } from './services/data-migrator.service';
import { ComplianceValidatorService } from './services/compliance-validator.service';
import { RegionDetector } from './utils/region-detector';
import { CreateRegionConfigDto } from './dto/region-config.dto';
import { DataLocationDto, DataLocationResponseDto, MigrateDataLocationDto } from './dto/data-location.dto';
import { ComplianceCheckDto, ComplianceResultDto, ComplianceReportDto, ComplianceStatus } from './dto/residency-compliance.dto';

@Injectable()
export class ResidencyManagerService {
  private readonly logger = new Logger(ResidencyManagerService.name);

  constructor(
    @InjectRepository(DataRegion)
    private readonly regionRepo: Repository<DataRegion>,
    @InjectRepository(ResidencyPolicy)
    private readonly policyRepo: Repository<ResidencyPolicy>,
    private readonly regionRouter: RegionRouterService,
    private readonly dataMigrator: DataMigratorService,
    private readonly complianceValidator: ComplianceValidatorService,
    private readonly regionDetector: RegionDetector,
  ) {}

  async assignUserRegion(dto: DataLocationDto): Promise<DataLocationResponseDto> {
    const routing: RoutingDecision = await this.regionRouter.routeUser(
      dto.userId,
      dto.countryCode,
      undefined,
      dto.requestedRegion,
    );

    const migrationRequired =
      dto.currentRegion !== routing.assignedRegion && !dto.forceMigration === false;

    const policies = await this.policyRepo.find({
      where: { regionId: routing.assignedRegion as unknown as string, status: PolicyStatus.ACTIVE },
    });

    this.logger.log(
      `Assigned user ${dto.userId} to region ${routing.assignedRegion} (migration=${migrationRequired})`,
    );

    return {
      userId: dto.userId,
      assignedRegion: routing.assignedRegion,
      storageEndpoint: routing.storageEndpoint,
      migrationRequired,
      applicablePolicies: policies.map((p) => p.policyType),
    };
  }

  async migrateUserData(dto: MigrateDataLocationDto): Promise<MigrationJob> {
    return this.dataMigrator.scheduleMigration(
      dto.userId,
      dto.sourceRegion,
      dto.targetRegion,
      dto.reason,
    );
  }

  async checkCompliance(dto: ComplianceCheckDto): Promise<ComplianceResultDto> {
    return this.complianceValidator.validateCompliance(dto);
  }

  async generateComplianceReport(region: RegionCode, userIds: string[]): Promise<ComplianceReportDto> {
    const regionEntity = await this.regionRepo.findOne({ where: { code: region } });
    const frameworks = regionEntity?.complianceFrameworks ?? [];

    const userResults = await Promise.all(
      userIds.map((userId) =>
        this.complianceValidator.validateCompliance({ userId, region }),
      ),
    );

    const compliant = userResults.filter((r) => r.status === ComplianceStatus.COMPLIANT).length;
    const nonCompliant = userResults.filter((r) => r.status === ComplianceStatus.NON_COMPLIANT).length;
    const pendingReview = userResults.filter((r) => r.status === ComplianceStatus.PENDING_REVIEW).length;

    const overallStatus =
      nonCompliant > 0
        ? ComplianceStatus.NON_COMPLIANT
        : pendingReview > 0
        ? ComplianceStatus.PENDING_REVIEW
        : ComplianceStatus.COMPLIANT;

    return {
      generatedAt: new Date().toISOString(),
      region,
      frameworks,
      overallStatus,
      userResults,
      summary: {
        totalUsers: userIds.length,
        compliant,
        nonCompliant,
        pendingReview,
      },
    };
  }

  async createRegion(dto: CreateRegionConfigDto): Promise<DataRegion> {
    const region = this.regionRepo.create({
      ...dto,
      status: RegionStatus.ACTIVE,
    });
    return this.regionRepo.save(region);
  }

  async getActiveRegions(): Promise<DataRegion[]> {
    return this.regionRouter.getAllActiveRegions();
  }

  getRegionForCountry(countryCode: string): RegionCode {
    return this.regionDetector.detectRegionByCountry(countryCode);
  }

  getMigrationJob(jobId: string): MigrationJob | undefined {
    return this.dataMigrator.getJob(jobId);
  }
}
