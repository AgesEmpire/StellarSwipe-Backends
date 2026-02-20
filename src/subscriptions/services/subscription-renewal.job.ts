import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserSubscription,
  SubscriptionStatus,
} from '../entities/user-subscription.entity';
import { SubscriptionsService } from '../subscriptions.service';

/**
 * SubscriptionRenewalJob
 *
 * Runs on a daily schedule to:
 *   1. Expire subscriptions whose periodEnd has passed (and auto-renew is off)
 *   2. Emit "renewal due soon" notifications (stub – hook to notifications service)
 *   3. Mark suspended subscriptions as expired after grace period
 */
@Injectable()
export class SubscriptionRenewalJob {
  private readonly logger = new Logger(SubscriptionRenewalJob.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepo: Repository<UserSubscription>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Run every day at 02:00 UTC to detect expired subscriptions.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleExpiredSubscriptions(): Promise<void> {
    this.logger.log('Running expired subscriptions cleanup job');

    const expired = await this.subscriptionsService.getExpiredSubscriptions();

    let expiredCount = 0;
    for (const sub of expired) {
      try {
        await this.subscriptionRepo.update(sub.id, {
          status: SubscriptionStatus.EXPIRED,
          autoRenew: false,
        });

        // Decrement subscriber count on the tier
        await this.subscriptionRepo.manager.query(
          `UPDATE subscription_tiers SET subscriber_count = GREATEST(subscriber_count - 1, 0) WHERE id = $1`,
          [sub.tierId],
        );

        expiredCount++;
        this.logger.debug(`Expired subscription ${sub.id} for user ${sub.userId}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to expire subscription ${sub.id}: ${err.message}`,
          err.stack,
        );
      }
    }

    this.logger.log(`Expired ${expiredCount} subscriptions`);
  }

  /**
   * Run every day at 06:00 UTC to send renewal reminder notifications
   * to users whose renewsAt date is today.
   *
   * NOTE: Notification emission is stubbed here – plug in your notification
   * service (email, push, in-app) in sendRenewalNotification().
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async handleRenewalNotifications(): Promise<void> {
    this.logger.log('Running renewal notification job');

    const now = new Date();
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const dueSoon = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .leftJoinAndSelect('sub.tier', 'tier')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.auto_renew = TRUE')
      .andWhere('sub.renews_at BETWEEN :start AND :end', {
        start: now,
        end: dayEnd,
      })
      .getMany();

    this.logger.log(`Sending renewal notifications to ${dueSoon.length} subscribers`);

    for (const sub of dueSoon) {
      try {
        await this.sendRenewalNotification(sub);
      } catch (err: any) {
        this.logger.error(
          `Failed to send renewal notification for ${sub.id}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Retry payment for suspended subscriptions (runs every 6 hours).
   * In production this would trigger a payment window or alert the user.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleSuspendedSubscriptions(): Promise<void> {
    this.logger.log('Checking suspended subscriptions for retry eligibility');

    const suspended = await this.subscriptionRepo.find({
      where: { status: SubscriptionStatus.SUSPENDED },
      relations: ['tier'],
    });

    this.logger.log(`Found ${suspended.length} suspended subscriptions`);

    for (const sub of suspended) {
      // If period has passed completely, expire it
      if (sub.periodEnd < new Date()) {
        await this.subscriptionRepo.update(sub.id, {
          status: SubscriptionStatus.EXPIRED,
        });
        this.logger.warn(
          `Subscription ${sub.id} expired after exceeding grace period`,
        );
        continue;
      }

      // Otherwise notify user to retry payment
      this.logger.warn(
        `User ${sub.userId} has suspended subscription ${sub.id} – notifying to retry payment`,
      );
      await this.notifyPaymentFailure(sub);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  STUBS  – replace with actual notification implementations
  // ─────────────────────────────────────────────────────────────

  private async sendRenewalNotification(sub: UserSubscription): Promise<void> {
    this.logger.log(
      `[NOTIFY] Renewal due for user ${sub.userId} – tier: ${sub.tier?.name}, ` +
        `amount: ${sub.amountPaid} USDC, renews at: ${sub.renewsAt?.toISOString()}`,
    );
    // TODO: emit to notifications service / email
  }

  private async notifyPaymentFailure(sub: UserSubscription): Promise<void> {
    this.logger.warn(
      `[NOTIFY] Payment failure for user ${sub.userId} – subscription ${sub.id} is suspended. ` +
        `Failure count: ${sub.paymentFailureCount}`,
    );
    // TODO: emit to notifications service / email
  }
}
