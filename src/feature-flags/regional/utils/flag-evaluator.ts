import { Injectable } from '@nestjs/common';
import { RegionalFlagConfig } from '../entities/regional-flag-config.entity';
import { RegionalFlagEvaluationResult } from '../dto/regional-flag.dto';

@Injectable()
export class FlagEvaluator {
  evaluate(
    flagName: string,
    region: string,
    configs: RegionalFlagConfig[],
    globalEnabled: boolean,
  ): RegionalFlagEvaluationResult {
    // Exact regional match takes highest priority
    const regionalConfig = configs.find(
      (c) => c.flagName === flagName && c.region === region,
    );
    if (regionalConfig) {
      return {
        flagName,
        region,
        enabled: regionalConfig.enabled,
        overrides: regionalConfig.overrides ?? {},
        resolvedFrom: 'regional',
      };
    }

    // Parent macro-region or GLOBAL config
    const fallbackConfig = configs
      .filter((c) => c.flagName === flagName && c.region !== region)
      .sort((a, b) => (a.region === 'GLOBAL' ? 1 : -1))[0];

    if (fallbackConfig) {
      return {
        flagName,
        region,
        enabled: fallbackConfig.enabled,
        overrides: fallbackConfig.overrides ?? {},
        resolvedFrom: 'global',
      };
    }

    return {
      flagName,
      region,
      enabled: globalEnabled,
      overrides: {},
      resolvedFrom: 'default',
    };
  }

  evaluateBulk(
    flagNames: string[],
    region: string,
    configs: RegionalFlagConfig[],
    globalFlags: Record<string, boolean>,
  ): RegionalFlagEvaluationResult[] {
    return flagNames.map((flagName) =>
      this.evaluate(flagName, region, configs, globalFlags[flagName] ?? false),
    );
  }
}
