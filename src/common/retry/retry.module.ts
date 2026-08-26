import { Global, Module } from '@nestjs/common';
import { RetryPolicyService } from './retry-policy.service';

/**
 * Global module exposing `RetryPolicyService` so any integration client
 * across the app can inject it without every feature module needing to
 * import a dedicated retry module.
 */
@Global()
@Module({
  providers: [RetryPolicyService],
  exports: [RetryPolicyService],
})
export class RetryModule {}
