import { Module } from '@nestjs/common';
import { AffiliateModule } from './affiliates/affiliate.module';

@Module({
  imports: [AffiliateModule],
  exports: [AffiliateModule],
})
export class PartnershipsModule {}
