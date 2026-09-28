import { Global, Module } from '@nestjs/common';
import { AdvisoryLockService } from './advisory-lock.service';

/**
 * Global so any module (migrations, cron jobs, CLI commands) can inject
 * AdvisoryLockService without re-declaring the provider.
 */
@Global()
@Module({
  providers: [AdvisoryLockService],
  exports: [AdvisoryLockService],
})
export class AdvisoryLockModule {}
