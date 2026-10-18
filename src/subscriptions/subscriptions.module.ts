import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionTier } from './entities/subscription-tier.entity';
import { UserSubscription } from './entities/user-subscription.entity';
import { User } from '../users/entities/user.entity';
import { UserPreference } from '../users/entities/user-preference.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PaymentProcessorService } from './services/payment-processor.service';
import { AccessControlService } from './services/access-control.service';
import { ProviderProfileService } from './services/provider-profile.service';
import { SubscriptionNotificationService } from './services/subscription-notification.service';
import { SubscriptionRenewalJob } from './services/subscription-renewal.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { I18nModule } from '../i18n/i18n.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionTier,
      UserSubscription,
      User,
      UserPreference,
    ]),
    ConfigModule,
    ScheduleModule.forRoot(),
    NotificationsModule,
    I18nModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    PaymentProcessorService,
    AccessControlService,
    ProviderProfileService,
    SubscriptionNotificationService,
    SubscriptionRenewalJob,
    SubscriptionChangeNotifierService,
  ],
  exports: [
    SubscriptionsService,
    AccessControlService,
    PaymentProcessorService,
    ProviderProfileService,
    SubscriptionNotificationService,
    TypeOrmModule,
  ],
})
export class SubscriptionsModule {}
