import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PaymentProcessorService } from './services/payment-processor.service';
import { AccessControlService } from './services/access-control.service';
import { SubscriptionTier } from './entities/subscription-tier.entity';
import { UserSubscription } from './entities/user-subscription.entity';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([SubscriptionTier, UserSubscription]),
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PaymentProcessorService, AccessControlService],
  exports: [SubscriptionsService, AccessControlService],
})
export class SubscriptionsModule {}
