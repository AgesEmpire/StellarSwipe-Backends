import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliateController } from './affiliate.controller';
import { AffiliateService } from './affiliate.service';
import { Affiliate } from './entities/affiliate.entity';
import { AffiliateConversion } from './entities/affiliate-conversion.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Affiliate, AffiliateConversion]),
  ],
  controllers: [AffiliateController],
  providers: [AffiliateService],
  exports: [AffiliateService],
})
export class AffiliateModule {}
