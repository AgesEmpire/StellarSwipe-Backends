import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceCheck } from './entities/compliance-check.entity';
import { RegionalRule } from './entities/regional-rule.entity';
import {
  ComplianceRegion,
  ComplianceCheckContext,
  ComplianceCheckResult,
  IComplianceFramework,
} from './interfaces/compliance-framework.interface';
import { EuGdprFramework } from './frameworks/eu-gdpr.framework';
import { UsFinraFramework } from './frameworks/us-finra.framework';
import { NigeriaSecFramework } from './frameworks/nigeria-sec.framework';
import { RegionDetector } from './utils/region-detector';

@Injectable()
export class RegionalComplianceService {
  private readonly logger = new Logger(RegionalComplianceService.name);
  private readonly frameworks = new Map<ComplianceRegion, IComplianceFramework>();

  constructor(
    @InjectRepository(ComplianceCheck)
    private readonly checkRepo: Repository<ComplianceCheck>,
    @InjectRepository(RegionalRule)
    private readonly ruleRepo: Repository<RegionalRule>,
    private readonly euFramework: EuGdprFramework,
    private readonly usFramework: UsFinraFramework,
    private readonly ngFramework: NigeriaSecFramework,
    private readonly regionDetector: RegionDetector,
  ) {
    this.frameworks.set(ComplianceRegion.EU, euFramework);
    this.frameworks.set(ComplianceRegion.US, usFramework);
    this.frameworks.set(ComplianceRegion.NG, ngFramework);
  }

  async runCheck(context: ComplianceCheckContext): Promise<ComplianceCheckResult> {
    const framework = this.frameworks.get(context.region);
    if (!framework) {
      this.logger.warn(`No framework for region ${context.region}, skipping check`);
      return {
        passed: true,
        region: context.region,
        checkedRules: [],
        violations: [],
        timestamp: new Date(),
      };
    }

    const result = await framework.check(context);

    await this.checkRepo.save(
      this.checkRepo.create({
        userId: context.userId,
        region: context.region,
        action: context.action,
        passed: result.passed,
        checkedRules: result.checkedRules,
        violations: result.violations,
        ipAddress: context.ipAddress,
        payload: context.payload,
      }),
    );

    this.logger.log(
      `Compliance check for user ${context.userId} in ${context.region}: ${result.passed ? 'PASSED' : 'FAILED'} (${result.violations.length} violations)`,
    );

    return result;
  }

  getFrameworkRules(region: ComplianceRegion) {
    const framework = this.frameworks.get(region);
    if (!framework) throw new NotFoundException(`No compliance framework for region ${region}`);
    return framework.getRules();
  }

  getRequiredDocuments(region: ComplianceRegion): string[] {
    const framework = this.frameworks.get(region);
    if (!framework) throw new NotFoundException(`No compliance framework for region ${region}`);
    return framework.getRequiredDocuments();
  }

  getDataRetentionPolicy(region: ComplianceRegion) {
    const framework = this.frameworks.get(region);
    if (!framework) throw new NotFoundException(`No compliance framework for region ${region}`);
    return framework.getDataRetentionPolicy();
  }

  detectRegion(countryCode: string): ComplianceRegion {
    return this.regionDetector.detectFromCountryCode(countryCode);
  }

  async getCheckHistory(userId: string, region?: ComplianceRegion): Promise<ComplianceCheck[]> {
    const query = this.checkRepo.createQueryBuilder('check').where('check.userId = :userId', { userId });
    if (region) query.andWhere('check.region = :region', { region });
    return query.orderBy('check.createdAt', 'DESC').limit(50).getMany();
  }

  async getActiveRules(region: ComplianceRegion): Promise<RegionalRule[]> {
    return this.ruleRepo.find({ where: { region, isActive: true } });
  }
}
