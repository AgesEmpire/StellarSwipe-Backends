import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PathFinderService } from './path-finder.service';
import { PathPaymentService } from './path-payment.service';
import { PathPaymentController } from './path-payment.controller';

@Module({
  imports: [ConfigModule],
  providers: [PathFinderService, PathPaymentService],
  controllers: [PathPaymentController],
  exports: [PathFinderService, PathPaymentService],
})
export class PathPaymentModule {}
