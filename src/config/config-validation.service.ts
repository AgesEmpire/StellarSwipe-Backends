import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ValidationRule {
  key: string;
  required: boolean;
  validate?: (value: any) => boolean;
  errorMessage?: string;
}

@Injectable()
export class ConfigValidationService implements OnModuleInit {
  private readonly logger = new Logger(ConfigValidationService.name);

  private readonly validationRules: ValidationRule[] = [
    // Database configuration
    {
      key: 'DATABASE_HOST',
      required: true,
      errorMessage: 'DATABASE_HOST is required',
    },
    {
      key: 'DATABASE_PORT',
      required: true,
      validate: (value) => !isNaN(parseInt(value, 10)) && parseInt(value, 10) > 0,
      errorMessage: 'DATABASE_PORT must be a valid port number',
    },
    {
      key: 'DATABASE_NAME',
      required: true,
      errorMessage: 'DATABASE_NAME is required',
    },
    // Redis configuration
    {
      key: 'REDIS_HOST',
      required: true,
      errorMessage: 'REDIS_HOST is required',
    },
    {
      key: 'REDIS_PORT',
      required: true,
      validate: (value) => !isNaN(parseInt(value, 10)) && parseInt(value, 10) > 0,
      errorMessage: 'REDIS_PORT must be a valid port number',
    },
    // JWT configuration
    {
      key: 'JWT_SECRET',
      required: true,
      validate: (value) => value && value.length >= 32,
      errorMessage: 'JWT_SECRET must be at least 32 characters',
    },
    // Encryption key
    {
      key: 'ENCRYPTION_KEY',
      required: true,
      validate: (value) => value && value.length >= 32,
      errorMessage: 'ENCRYPTION_KEY must be at least 32 characters',
    },
    // Stellar configuration
    {
      key: 'STELLAR_NETWORK',
      required: false,
      validate: (value) => !value || ['testnet', 'public'].includes(value),
      errorMessage: 'STELLAR_NETWORK must be either "testnet" or "public"',
    },
    // API configuration
    {
      key: 'API_PORT',
      required: true,
      validate: (value) => !isNaN(parseInt(value, 10)) && parseInt(value, 10) > 0,
      errorMessage: 'API_PORT must be a valid port number',
    },
    {
      key: 'NODE_ENV',
      required: true,
      validate: (value) => ['development', 'staging', 'production'].includes(value),
      errorMessage: 'NODE_ENV must be development, staging, or production',
    },
  ];

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    this.logger.log('Starting configuration validation...');

    const errors: string[] = [];

    for (const rule of this.validationRules) {
      const value = process.env[rule.key];

      // Check if required
      if (rule.required && (!value || value.trim() === '')) {
        errors.push(rule.errorMessage || `${rule.key} is required`);
        continue;
      }

      // Skip validation if not required and not provided
      if (!rule.required && (!value || value.trim() === '')) {
        continue;
      }

      // Run custom validation
      if (rule.validate && !rule.validate(value)) {
        errors.push(rule.errorMessage || `${rule.key} validation failed`);
      }
    }

    if (errors.length > 0) {
      this.logger.error('Configuration validation failed:');
      errors.forEach((error) => this.logger.error(`  - ${error}`));
      throw new Error(
        `Configuration validation failed with ${errors.length} error(s). ` +
          'Check logs for details.',
      );
    }

    this.logger.log(
      `Configuration validation passed. All ${this.validationRules.length} rules validated successfully.`,
    );
  }

  /**
   * Add a custom validation rule at runtime
   */
  addValidationRule(rule: ValidationRule): void {
    this.validationRules.push(rule);
    this.logger.debug(`Added validation rule for ${rule.key}`);
  }

  /**
   * Get all validation rules
   */
  getValidationRules(): ValidationRule[] {
    return [...this.validationRules];
  }
}
