import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

export interface RequiredEnvVar {
  key: string;
  description: string;
}

export interface ServiceDependencyCheck {
  name: string;
  check: () => Promise<boolean>;
}

/**
 * Validates required environment variables, secrets, and service dependencies
 * at startup so misconfiguration fails fast with an actionable error instead
 * of surfacing as a runtime failure later.
 *
 * Not wired into AppModule yet. To enable, import StartupValidationModule
 * and extend REQUIRED_ENV_VARS / dependency checks for this service's needs.
 */
@Injectable()
export class StartupValidatorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupValidatorService.name);

  private readonly requiredEnvVars: RequiredEnvVar[] = [
    { key: 'NODE_ENV', description: 'Runtime environment (development|staging|production)' },
    { key: 'DATABASE_URL', description: 'Primary database connection string' },
    { key: 'JWT_SECRET', description: 'Secret used to sign auth tokens' },
  ];

  private readonly dependencyChecks: ServiceDependencyCheck[] = [];

  async onApplicationBootstrap(): Promise<void> {
    await this.validate();
  }

  async validate(): Promise<void> {
    const missing = this.requiredEnvVars.filter((v) => !process.env[v.key]?.trim());

    if (missing.length > 0) {
      const details = missing
        .map((v) => `  - ${v.key}: ${v.description}`)
        .join('\n');
      throw new Error(
        `Startup validation failed: missing required environment variable(s):\n${details}\n` +
          `Set these in your environment or .env file before starting the service.`,
      );
    }

    for (const dependency of this.dependencyChecks) {
      try {
        const healthy = await dependency.check();
        if (!healthy) {
          throw new Error(`Dependency check returned unhealthy for "${dependency.name}"`);
        }
        this.logger.log(`Startup dependency check passed: ${dependency.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Startup validation failed: dependency "${dependency.name}" is unreachable: ${message}\n` +
            `Verify the service is running and reachable before starting the app.`,
        );
      }
    }

    this.logger.log(
      `Startup validation passed: ${this.requiredEnvVars.length} env var(s), ` +
        `${this.dependencyChecks.length} dependency check(s)`,
    );
  }

  registerDependencyCheck(check: ServiceDependencyCheck): void {
    this.dependencyChecks.push(check);
  }

  registerRequiredEnvVar(envVar: RequiredEnvVar): void {
    this.requiredEnvVars.push(envVar);
  }
}
