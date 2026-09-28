import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SponsoredReservesService } from './sponsored-reserves.service';
import { SponsoredReservesController } from './sponsored-reserves.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SponsoredReservesController],
  providers: [SponsoredReservesService],
  exports: [SponsoredReservesService],
})
export class SponsoredReservesModule {}
