import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionTier } from './entities/subscription-tier.entity';
import { UserSubscription } from './entities/user-subscription.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PaymentProcessorService } from './services/payment-processor.service';
import { AccessControlService } from './services/access-control.service';
import { SubscriptionRenewalJob } from './services/subscription-renewal.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionTier, UserSubscription]),
    ConfigModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    PaymentProcessorService,
    AccessControlService,
    SubscriptionRenewalJob,
  ],
  exports: [
    SubscriptionsService,
    AccessControlService,
    PaymentProcessorService,
    TypeOrmModule,
  ],
})
export class SubscriptionsModule {}
