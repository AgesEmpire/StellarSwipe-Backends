import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { configSchema } from './schemas/config.schema';

/**
 * Validates all required environment variables at startup via the shared
 * Joi configSchema.  A missing or invalid variable aborts the process with
 * a human-readable message so misconfiguration is caught before any service
 * dependency is reached.
 */
@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

  onModuleInit(): void {
    this.validate();
  }

  validate(): void {
    const { error } = configSchema.validate(process.env, {
      allowUnknown: true,
      abortEarly: false,
    });

    if (!error) {
      this.logger.log('Environment configuration validated successfully.');
      return;
    }

    const messages = error.details.map((d) => `  • ${d.message}`).join('\n');
    this.logger.error(
      `Application startup aborted – environment misconfiguration:\n${messages}`,
    );
    // Throw so NestJS bootstrap() rejects and the process exits with a
    // non-zero code, making deployment failures immediately visible.
    throw new Error(
      `Missing or invalid environment variables:\n${messages}`,
    );
  }
}
