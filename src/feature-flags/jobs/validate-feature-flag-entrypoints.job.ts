import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { KNOWN_CONTRACT_ENTRYPOINTS, isValidEntrypoint } from '../constants/contract-entrypoints.registry';

@Injectable()
export class ValidateFeatureFlagEntrypointsJob {
  private readonly logger = new Logger(ValidateFeatureFlagEntrypointsJob.name);

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepository: Repository<FeatureFlag>,
  ) {}

  @Cron('0 2 * * *', { name: 'validate-feature-flag-entrypoints', timeZone: 'UTC' })
  async run(): Promise<void> {
    this.logger.log('Starting feature flag entrypoint validation…');

    const flags = await this.flagRepository.find({
      where: { contractId: Not(IsNull()), method: Not(IsNull()) },
    });

    if (flags.length === 0) {
      this.logger.log('No contract-scoped feature flags found.');
      return;
    }

    let validCount = 0;
    let retiredCount = 0;
    let invalidCount = 0;
    const invalidFlags: string[] = [];

    for (const flag of flags) {
      if (flag.retired) {
        this.logger.debug(
          `Flag "${flag.name}" is intentionally retired — skipping validation`,
        );
        retiredCount++;
        continue;
      }

      const contractExists = flag.contractId in KNOWN_CONTRACT_ENTRYPOINTS;
      const methodValid = contractExists && isValidEntrypoint(flag.contractId, flag.method);

      if (methodValid) {
        validCount++;
      } else {
        invalidCount++;
        invalidFlags.push(flag.name);
        const reason = !contractExists
          ? `contract "${flag.contractId}" is not in the entrypoint registry`
          : `method "${flag.method}" does not exist on contract "${flag.contractId}"`;
        this.logger.warn(
          `Feature flag "${flag.name}" references an invalid target: ${reason}`,
        );
      }
    }

    this.logger.log(
      `Feature flag entrypoint validation complete — valid: ${validCount}, ` +
        `retired: ${retiredCount}, invalid: ${invalidCount}`,
    );

    if (invalidCount > 0) {
      this.logger.error(
        `Detected ${invalidCount} feature flag(s) with missing entrypoints: ${invalidFlags.join(', ')}`,
      );
    }
  }
}
