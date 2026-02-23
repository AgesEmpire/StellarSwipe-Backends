import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionTier } from './entities/subscription-tier.entity';
import { UserSubscription, SubscriptionStatus } from './entities/user-subscription.entity';
import { CreateTierDto, UpdateTierDto } from './dto/create-tier.dto';
import { SubscribeDto, CancelSubscriptionDto } from './dto/subscribe.dto';
import { PaymentProcessorService } from './services/payment-processor.service';
import { AccessControlService } from './services/access-control.service';

const MAX_PAYMENT_RETRIES = 3;
const RETRY_DELAY_HOURS = 24;
const RENEWAL_NOTICE_DAYS = 3; // notify 3 days before renewal

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionTier)
    private readonly tierRepo: Repository<SubscriptionTier>,

    @InjectRepository(UserSubscription)
    private readonly subscriptionRepo: Repository<UserSubscription>,

    private readonly paymentProcessor: PaymentProcessorService,
    private readonly accessControl: AccessControlService,
  ) {}

  // ─── Tier Management ──────────────────────────────────────────────────────

  async createTier(providerId: string, dto: CreateTierDto): Promise<SubscriptionTier> {
    const tier = this.tierRepo.create({ ...dto, providerId });
    return this.tierRepo.save(tier);
  }

  async updateTier(
    providerId: string,
    tierId: string,
    dto: UpdateTierDto,
  ): Promise<SubscriptionTier> {
    const tier = await this.getTierOrFail(tierId);
    if (tier.providerId !== providerId) throw new ForbiddenException('Not your tier');

    // If deactivating a tier that has active subscribers, handle migration
    if (dto.active === false && tier.active) {
      await this.handleTierDeactivation(tier);
    }

    Object.assign(tier, dto);
    return this.tierRepo.save(tier);
  }

  async getProviderTiers(providerId: string): Promise<SubscriptionTier[]> {
    return this.tierRepo.find({ where: { providerId } });
  }

  async getActiveTiers(providerId: string): Promise<SubscriptionTier[]> {
    return this.tierRepo.find({ where: { providerId, active: true } });
  }

  // ─── Subscription Management ──────────────────────────────────────────────

  async subscribe(userId: string, dto: SubscribeDto): Promise<UserSubscription> {
    const tier = await this.getTierOrFail(dto.tierId);

    if (!tier.active) throw new BadRequestException('This subscription tier is not available');

    // Prevent duplicate active subscription to same tier
    const existing = await this.subscriptionRepo.findOne({
      where: { userId, tierId: tier.id, status: SubscriptionStatus.ACTIVE },
    });
    if (existing) throw new BadRequestException('Already subscribed to this tier');

    // Create subscription record
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);

    const subscription = this.subscriptionRepo.create({
      userId,
      tierId: tier.id,
      stellarAddress: dto.stellarAddress,
      autoRenew: dto.autoRenew ?? true,
      status: SubscriptionStatus.PENDING,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    const saved = await this.subscriptionRepo.save(subscription);

    // Process initial payment
    if (tier.price > 0) {
      const paymentResult = await this.paymentProcessor.processSubscriptionPayment({
        fromAddress: dto.stellarAddress,
        providerAddress: await this.getProviderStellarAddress(tier.providerId),
        amount: tier.price,
        subscriptionId: saved.id,
      });

      if (!paymentResult.success) {
        await this.subscriptionRepo.update(saved.id, { status: SubscriptionStatus.SUSPENDED });
        throw new BadRequestException(`Payment failed: ${paymentResult.error}`);
      }

      await this.subscriptionRepo.update(saved.id, {
        lastPaymentTx: paymentResult.transactionHash,
        lastPaymentAt: now,
      });
    }

    // Grant access
    await this.accessControl.grantAccess(saved.id);
    this.logger.log(`User ${userId} subscribed to tier ${tier.id}`);

    return this.subscriptionRepo.findOne({ where: { id: saved.id }, relations: ['tier'] });
  }

  async cancelSubscription(userId: string, dto: CancelSubscriptionDto): Promise<UserSubscription> {
    const subscription = await this.getSubscriptionOrFail(dto.subscriptionId);
    if (subscription.userId !== userId) throw new ForbiddenException('Not your subscription');
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Subscription is already cancelled');
    }

    if (dto.immediate) {
      await this.accessControl.revokeAccess(subscription.id, 'cancelled');
    } else {
      // Cancel at period end – keep status active until renewal date
      subscription.autoRenew = false;
    }

    subscription.cancelledAt = new Date();
    return this.subscriptionRepo.save(subscription);
  }

  async getUserSubscriptions(userId: string): Promise<UserSubscription[]> {
    return this.subscriptionRepo.find({ where: { userId }, relations: ['tier'] });
  }

  async getSubscription(subscriptionId: string): Promise<UserSubscription> {
    return this.getSubscriptionOrFail(subscriptionId);
  }

  async changeTier(
    userId: string,
    subscriptionId: string,
    newTierId: string,
  ): Promise<UserSubscription> {
    const subscription = await this.getSubscriptionOrFail(subscriptionId);
    if (subscription.userId !== userId) throw new ForbiddenException('Not your subscription');

    const newTier = await this.getTierOrFail(newTierId);
    if (!newTier.active) throw new BadRequestException('Target tier is not available');

    // Ensure same provider
    if (newTier.providerId !== subscription.tier.providerId) {
      throw new BadRequestException('Cannot change to a tier from a different provider');
    }

    // For mid-month upgrades: charge pro-rated difference immediately
    if (newTier.price > subscription.tier.price) {
      const now = new Date();
      const periodMs = subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime();
      const remainingMs = subscription.currentPeriodEnd.getTime() - now.getTime();
      const proratedDiff =
        ((newTier.price - subscription.tier.price) * remainingMs) / periodMs;

      const paymentResult = await this.paymentProcessor.processSubscriptionPayment({
        fromAddress: subscription.stellarAddress,
        providerAddress: await this.getProviderStellarAddress(newTier.providerId),
        amount: parseFloat(proratedDiff.toFixed(7)),
        subscriptionId: subscription.id,
      });

      if (!paymentResult.success) {
        throw new BadRequestException(`Pro-rated payment failed: ${paymentResult.error}`);
      }
    }

    subscription.tierId = newTierId;
    return this.subscriptionRepo.save(subscription);
  }

  // ─── Access Control Delegation ────────────────────────────────────────────

  async checkAccess(params: {
    userId: string;
    providerId: string;
    requiredTierId?: string;
  }): Promise<{ allowed: boolean; reason?: string }> {
    return this.accessControl.canAccessSignal(params);
  }

  // ─── Revenue Reporting ────────────────────────────────────────────────────

  async getProviderRevenue(providerId: string): Promise<{
    totalRevenue: number;
    platformCommission: number;
    providerEarnings: number;
    activeSubscribers: number;
  }> {
    const tiers = await this.tierRepo.find({ where: { providerId } });
    const tierIds = tiers.map((t) => t.id);

    if (!tierIds.length) {
      return { totalRevenue: 0, platformCommission: 0, providerEarnings: 0, activeSubscribers: 0 };
    }

    const activeCount = await this.subscriptionRepo.count({
      where: tierIds.map((id) => ({ tierId: id, status: SubscriptionStatus.ACTIVE })) as any,
    });

    // Sum monthly recurring revenue from active subscriptions
    const subs = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .innerJoin('sub.tier', 'tier')
      .where('tier.provider_id = :providerId', { providerId })
      .andWhere('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .select(['sub.id', 'tier.price', 'tier.platformCommission'])
      .getRawMany();

    let totalRevenue = 0;
    let totalCommission = 0;

    for (const row of subs) {
      const price = parseFloat(row.tier_price);
      const commission = parseFloat(row.tier_platformCommission) / 100;
      totalRevenue += price;
      totalCommission += price * commission;
    }

    return {
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      platformCommission: parseFloat(totalCommission.toFixed(2)),
      providerEarnings: parseFloat((totalRevenue - totalCommission).toFixed(2)),
      activeSubscribers: activeCount,
    };
  }

  // ─── Scheduled Jobs ──────────────────────────────────────────────────────

  /** Run daily: renew subscriptions expiring today */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processRenewals(): Promise<void> {
    const now = new Date();
    const expiring = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
        currentPeriodEnd: LessThanOrEqual(now),
      },
      relations: ['tier'],
    });

    this.logger.log(`Processing ${expiring.length} subscription renewals`);

    for (const sub of expiring) {
      await this.renewSubscription(sub);
    }
  }

  /** Run daily: send renewal notices 3 days in advance */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendRenewalNotices(): Promise<void> {
    const noticeDate = new Date();
    noticeDate.setDate(noticeDate.getDate() + RENEWAL_NOTICE_DAYS);

    const upcoming = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.tier', 'tier')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.auto_renew = true')
      .andWhere('sub.current_period_end <= :noticeDate', { noticeDate })
      .andWhere('sub.current_period_end > :now', { now: new Date() })
      .getMany();

    for (const sub of upcoming) {
      await this.sendRenewalNotification(sub);
    }
  }

  /** Run every 6 hours: retry failed payments */
  @Cron('0 */6 * * *')
  async retryFailedPayments(): Promise<void> {
    const now = new Date();
    const suspended = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.SUSPENDED,
        nextRetryAt: LessThanOrEqual(now),
      },
      relations: ['tier'],
    });

    for (const sub of suspended) {
      if (sub.paymentFailureCount >= MAX_PAYMENT_RETRIES) {
        this.logger.warn(`Subscription ${sub.id} exceeded max retries. Expiring.`);
        await this.accessControl.revokeAccess(sub.id, 'expired');
        continue;
      }
      await this.renewSubscription(sub);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async renewSubscription(sub: UserSubscription): Promise<void> {
    try {
      const result = await this.paymentProcessor.processSubscriptionPayment({
        fromAddress: sub.stellarAddress,
        providerAddress: await this.getProviderStellarAddress(sub.tier.providerId),
        amount: sub.tier.price,
        subscriptionId: sub.id,
      });

      if (result.success) {
        const newStart = new Date();
        const newEnd = new Date(newStart);
        newEnd.setDate(newEnd.getDate() + 30);

        await this.subscriptionRepo.update(sub.id, {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: newStart,
          currentPeriodEnd: newEnd,
          lastPaymentTx: result.transactionHash,
          lastPaymentAt: newStart,
          paymentFailureCount: 0,
          nextRetryAt: null,
        });

        this.logger.log(`Renewed subscription ${sub.id}`);
      } else {
        await this.handlePaymentFailure(sub);
      }
    } catch (err) {
      this.logger.error(`Renewal error for ${sub.id}: ${err.message}`);
      await this.handlePaymentFailure(sub);
    }
  }

  private async handlePaymentFailure(sub: UserSubscription): Promise<void> {
    const failureCount = sub.paymentFailureCount + 1;
    const nextRetry = new Date();
    nextRetry.setHours(nextRetry.getHours() + RETRY_DELAY_HOURS);

    await this.subscriptionRepo.update(sub.id, {
      status: SubscriptionStatus.SUSPENDED,
      paymentFailureCount: failureCount,
      nextRetryAt: nextRetry,
    });

    await this.accessControl.revokeAccess(sub.id, 'payment_failure');
    this.logger.warn(`Payment failure #${failureCount} for subscription ${sub.id}`);

    // TODO: emit event / send notification to user about payment failure
  }

  private async handleTierDeactivation(tier: SubscriptionTier): Promise<void> {
    const activeSubscriptions = await this.subscriptionRepo.find({
      where: { tierId: tier.id, status: SubscriptionStatus.ACTIVE },
    });

    this.logger.warn(
      `Tier ${tier.id} deactivated with ${activeSubscriptions.length} active subscribers`,
    );

    // Allow current period to complete – set autoRenew=false for all
    for (const sub of activeSubscriptions) {
      await this.subscriptionRepo.update(sub.id, { autoRenew: false });
    }

    // TODO: notify affected subscribers
  }

  private async sendRenewalNotification(sub: UserSubscription): Promise<void> {
    // TODO: integrate with notification service (email, push, etc.)
    this.logger.log(
      `Renewal notice: user ${sub.userId}, tier ${sub.tier.name}, ` +
        `renews ${sub.currentPeriodEnd.toISOString()}`,
    );
  }

  private async getProviderStellarAddress(providerId: string): Promise<string> {
    // TODO: fetch from provider profile service / DB
    // Placeholder – replace with real lookup
    return `PROVIDER_STELLAR_${providerId}`;
  }

  private async getTierOrFail(tierId: string): Promise<SubscriptionTier> {
    const tier = await this.tierRepo.findOne({ where: { id: tierId } });
    if (!tier) throw new NotFoundException(`Subscription tier ${tierId} not found`);
    return tier;
  }

  private async getSubscriptionOrFail(subscriptionId: string): Promise<UserSubscription> {
    const sub = await this.subscriptionRepo.findOne({
      where: { id: subscriptionId },
      relations: ['tier'],
    });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    return sub;
  }
}
