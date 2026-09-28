import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { validateEnvironment } from './schemas/config.schema';

/**
 * Validates all required environment variables at startup with the shared typed
 * schema. Missing or invalid values abort boot before downstream services are
 * constructed with unsafe defaults.
 */
@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

  onModuleInit(): void {
    this.validate();
  }

  validate(): void {
    try {
      validateEnvironment(process.env);
      this.logger.log('Environment configuration validated successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Application startup aborted - environment misconfiguration:\n${message}`,
      );
      throw error;
    }
  }
}
