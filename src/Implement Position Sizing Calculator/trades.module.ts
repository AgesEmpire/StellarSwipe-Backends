import { Module } from '@nestjs/common';
import { TradesController } from './trades.controller';
import { PositionSizingService } from './services/position-sizing.service';

@Module({
  controllers: [TradesController],
  providers: [PositionSizingService],
  exports: [PositionSizingService],
})
export class TradesModule {}
