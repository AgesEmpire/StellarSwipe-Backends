import { Module } from '@nestjs/common';
import { PricingFallbackService } from './pricing-fallback.service';

@Module({
  providers: [PricingFallbackService],
  exports: [PricingFallbackService],
})
export class PricingFallbackModule {}
