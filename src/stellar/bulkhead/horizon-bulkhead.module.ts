import { Global, Module } from '@nestjs/common';
import { HorizonBulkheadService } from './horizon-bulkhead.service';
import { HorizonBulkheadController } from './horizon-bulkhead.controller';

/**
 * Provides {@link HorizonBulkheadService} application-wide so any service
 * issuing Horizon API calls can route them through the shared, bounded,
 * per-category pools. Marked `@Global()` so feature modules don't each need to
 * import it explicitly.
 */
@Global()
@Module({
  controllers: [HorizonBulkheadController],
  providers: [HorizonBulkheadService],
  exports: [HorizonBulkheadService],
})
export class HorizonBulkheadModule {}
