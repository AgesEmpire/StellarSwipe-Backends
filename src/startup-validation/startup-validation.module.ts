import { Module } from '@nestjs/common';
import { StartupValidatorService } from './startup-validator.service';

/**
 * Fails fast on missing required env vars/secrets and unreachable service
 * dependencies before the app finishes bootstrapping. Not wired into
 * AppModule yet — import this module there to enable it globally.
 */
@Module({
  providers: [StartupValidatorService],
  exports: [StartupValidatorService],
})
export class StartupValidationModule {}
