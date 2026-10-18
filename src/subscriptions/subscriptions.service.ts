import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual } from 'typeorm';
import Big from 'big.js';
import {
  SubscriptionTier,
  TierLevel,
} from './entities/subscription-tier.entity';
import {
  UserSubscription,
  SubscriptionStatus,
  PaymentStatus,
} from './entities/user-subscription.entity';
import { PaymentProcessorService } from './services/payment-processor.service';
import { AccessControlService } from './services/access-control.service';
import { ProviderProfileService } from './services/provider-profile.service';
import { SubscriptionNotificationService } from './services/subscription-notification.service';
import { CreateTierDto, UpdateTierDto } from './dto/create-tier.dto';
import {
  SubscribeDto,
  CancelSubscriptionDto,
  RenewSubscriptionDto,
} from './dto/subscribe.dto';

/** Maximum consecutive payment failures before access is suspended */
const MAX_PAYMENT_FAILURES = 3;
/** Billing cycle length in days */
const BILLING_CYCLE_DAYS = 30;
/** Notify subscribers N days before renewal */
export const RENEWAL_NOTIFICATION_DAYS = 3;

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
    private readonly providerProfileService: ProviderProfileService,
    private readonly notificationService: SubscriptionNotificationService,
    private readonly dataSource: DataSource,
    private readonly changeNotifier: SubscriptionChangeNotifierService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  TIER MANAGEMENT  (provider-facing)
  // ─────────────────────────────────────────────────────────────

  /**
   * Provider creates a new subscription tier.
   * Enforces uniqueness of tier level per provider.
   */
  async createTier(
    providerId: string,
    _providerWallet: string,
    dto: CreateTierDto,
  ): Promise<SubscriptionTier> {
    // FREE tiers can only exist once per provider
    if (dto.level === TierLevel.FREE) {
      const existing = await this.tierRepo.findOne({
        where: { providerId, level: TierLevel.FREE, active: true },
      });
      if (existing) {
        throw new ConflictException('Provider already has an active FREE tier');
      }
    }

    // FREE tier must have price 0
    if (dto.level === TierLevel.FREE && dto.price !== 0) {
      throw new BadRequestException('FREE tier must have price 0');
    }

    // Paid tiers must have price > 0
    if (dto.level !== TierLevel.FREE && dto.price <= 0) {
      throw new BadRequestException('Paid tiers must have price > 0');
    }

    const tier = this.tierRepo.create({
      providerId,
      name: dto.name,
      description: dto.description,
      level: dto.level,
      price: String(dto.price),
      signalLimit: dto.signalLimit ?? null,
      benefits: dto.benefits,
      active: true,
      acceptingNewSubscribers: true,
    });

    const saved = await this.tierRepo.save(tier);
    this.logger.log(`Provider ${providerId} created tier "${saved.name}" (${saved.id})`);
    return saved;
  }

  /**
   * Update tier details. Provider cannot change the price while active
   * subscribers exist (mid-cycle pricing is not supported).
   */
  async updateTier(
    tierId: string,
    providerId: string,
    dto: UpdateTierDto,
  ): Promise<SubscriptionTier> {
    const tier = await this.getTierOrFail(tierId);

    if (tier.providerId !== providerId) {
      throw new ForbiddenException('You do not own this tier');
    }

    const before = this.snapshotTier(tier);

    // Price change guard
    if (
      dto.price !== undefined &&
      String(dto.price) !== tier.price &&
      tier.subscriberCount > 0
    ) {
      throw new BadRequestException(
        'Cannot change price while there are active subscribers. ' +
          'Close existing subscriptions first or create a new tier.',
      );
    }

    Object.assign(tier, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.benefits && { benefits: dto.benefits }),
      ...(dto.price !== undefined && { price: String(dto.price) }),
      ...(dto.signalLimit !== undefined && { signalLimit: dto.signalLimit }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.acceptingNewSubscribers !== undefined && {
        acceptingNewSubscribers: dto.acceptingNewSubscribers,
      }),
    });

    const saved = await this.tierRepo.save(tier);

    // Existing subscribers are notified about anything that alters their
    // access, pricing or entitlements. Notification failures never roll back
    // the tier update itself.
    await this.notifySubscribersOfChange(tierId, before, this.snapshotTier(saved));

    return saved;
  }

  /**
   * Provider soft-cancels a tier.
   * All active subscribers are cancelled and access revoked.
   */
  async cancelTier(tierId: string, providerId: string): Promise<void> {
    const tier = await this.getTierOrFail(tierId);

    if (tier.providerId !== providerId) {
      throw new ForbiddenException('You do not own this tier');
    }

    const before = this.snapshotTier(tier);
    const after: TierSnapshot = {
      ...before,
      active: false,
      acceptingNewSubscribers: false,
    };

    const affectedUserIds = await this.dataSource.transaction(async (manager) => {
      // Collect the affected subscribers before the bulk status update so they
      // can still be notified after the transaction commits.
      const affected = await manager.find(UserSubscription, {
        where: { tierId, status: SubscriptionStatus.ACTIVE },
        select: ['userId'],
      });

      // Revoke all active subscriptions
      await manager.update(
        UserSubscription,
        { tierId, status: SubscriptionStatus.ACTIVE },
        {
          status: SubscriptionStatus.CANCELLED,
          cancellationReason: 'Provider cancelled the subscription tier',
          cancelledAt: new Date(),
          autoRenew: false,
        },
      );

      // Deactivate tier
      await manager.update(SubscriptionTier, tierId, {
        active: false,
        acceptingNewSubscribers: false,
        subscriberCount: 0,
      });

      return Array.from(new Set(affected.map((subscription) => subscription.userId)));
    });

    this.logger.log(`Tier ${tierId} cancelled by provider ${providerId}`);

    await this.notifySubscribersOfChange(tierId, before, after, {
      userIds: affectedUserIds,
      force: true,
    });
  }

  /**
   * List all tiers for a provider (includes inactive for owner).
   */
  async getProviderTiers(providerId: string, includeInactive = false): Promise<SubscriptionTier[]> {
    const where: any = { providerId };
    if (!includeInactive) {
      where.active = true;
    }
    return this.tierRepo.find({ where, order: { price: 'ASC' } });
  }

  /**
   * Get a single tier (public).
   */
  async getTier(tierId: string): Promise<SubscriptionTier> {
    return this.getTierOrFail(tierId);
  }

  // ─────────────────────────────────────────────────────────────
  //  SUBSCRIPTION FLOW  (subscriber-facing)
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe a user to a tier.
   * 1. Validate tier availability
   * 2. Verify Stellar USDC payment
   * 3. Persist subscription and update revenue counters
   */
  async subscribe(
    userId: string,
    dto: SubscribeDto,
  ): Promise<UserSubscription> {
    const tier = await this.getTierOrFail(dto.tierId);

    // Validate the provider profile and that the plan metadata is current
    const providerProfile = await this.providerProfileService.loadProviderProfile(
      tier.providerId,
    );
    this.providerProfileService.assertProviderOperational(providerProfile);
    this.providerProfileService.assertPlanCurrent(tier, true);

    // Prevent duplicate active subscriptions to the same tier
    const existing = await this.subscriptionRepo.findOne({
      where: {
        userId,
        tierId: tier.id,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException('You already have an active subscription to this tier');
    }

    // For FREE tiers we skip payment verification
    if (tier.level !== TierLevel.FREE) {
      if (!providerProfile.walletAddress) {
        throw new BadRequestException('Provider wallet address is not configured');
      }

      const verification = await this.paymentProcessor.verifySubscriptionPayment(
        dto.stellarTxHash,
        tier.price,
        dto.subscriberWallet,
        providerProfile.walletAddress,
      );

      if (!verification.valid) {
        throw new BadRequestException(
          `Payment verification failed: ${verification.error}`,
        );
      }
    }

    // Calculate revenue split
    const { platformCommission, providerEarnings } =
      this.paymentProcessor.calculateRevenueSplit(tier.price);

    const now = new Date();
    const periodEnd = new Date(now.getTime() + BILLING_CYCLE_DAYS * 86_400_000);

    const saved = await this.dataSource.transaction(async (manager) => {
      const subscription = manager.create(UserSubscription, {
        userId,
        tierId: tier.id,
        providerId: tier.providerId,
        status: SubscriptionStatus.ACTIVE,
        amountPaid: tier.price,
        platformCommission,
        providerEarnings,
        stellarTxHash: tier.level === TierLevel.FREE ? undefined : dto.stellarTxHash,
        paymentStatus: PaymentStatus.COMPLETED,
        periodStart: now,
        periodEnd,
        renewsAt: new Date(periodEnd.getTime() - RENEWAL_NOTIFICATION_DAYS * 86_400_000),
        subscriberWallet: dto.subscriberWallet,
        providerWallet: providerProfile.walletAddress ?? '',
        autoRenew: dto.autoRenew ?? true,
        renewalCount: 0,
        paymentFailureCount: 0,
      });

      const created = await manager.save(UserSubscription, subscription);

      // Increment subscriber count and accumulate revenue on the tier
      const newTotal = new Big(tier.totalRevenue).plus(new Big(tier.price)).toFixed(7);
      await manager.update(SubscriptionTier, tier.id, {
        subscriberCount: () => '"subscriber_count" + 1',
        totalRevenue: newTotal,
      });

      this.logger.log(
        `User ${userId} subscribed to tier ${tier.id} (${tier.name}) – sub id: ${created.id}`,
      );

      return created;
    });

    // Emit the lifecycle notification after the transaction commits
    await this.safeNotify(
      () => this.notificationService.notifyCreated(saved, tier.name),
      `subscription created ${saved.id}`,
    );

    return saved;
  }

  /**
   * Cancel a subscription.
   * By default cancels at period end; pass immediate=true for instant revocation.
   */
  async cancelSubscription(
    subscriptionId: string,
    userId: string,
    dto: CancelSubscriptionDto,
  ): Promise<UserSubscription> {
    const sub = await this.getSubscriptionOrFail(subscriptionId);

    if (sub.userId !== userId) {
      throw new ForbiddenException('You do not own this subscription');
    }

    if (
      sub.status === SubscriptionStatus.CANCELLED ||
      sub.status === SubscriptionStatus.EXPIRED
    ) {
      throw new BadRequestException('Subscription is already cancelled or expired');
    }

    const now = new Date();
    const updates: Partial<UserSubscription> = {
      autoRenew: false,
      cancellationReason: dto.reason,
      cancelledAt: now,
    };

    if (dto.immediate) {
      updates.status = SubscriptionStatus.CANCELLED;
      // Decrement subscriber count
      await this.tierRepo.update(sub.tierId, {
        subscriberCount: () => 'GREATEST("subscriber_count" - 1, 0)',
      });
    }
    // else: let it expire naturally at periodEnd via the renewal job

    Object.assign(sub, updates);
    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Subscription ${subscriptionId} cancelled (immediate=${dto.immediate})`);

    await this.safeNotify(
      () =>
        this.notificationService.notifyCancelled(saved, {
          tierName: sub.tier?.name,
          immediate: dto.immediate,
        }),
      `subscription cancelled ${saved.id}`,
    );

    return saved;
  }

  /**
   * Pause a subscription's auto-renewal. Access continues until the current
   * period ends but the subscription will not be charged again until resumed.
   */
  async pauseSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<UserSubscription> {
    const sub = await this.getSubscriptionOrFail(subscriptionId);

    if (sub.userId !== userId) {
      throw new ForbiddenException('You do not own this subscription');
    }
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only active subscriptions can be paused');
    }
    if (!sub.autoRenew) {
      throw new BadRequestException('Subscription is already paused');
    }

    const occurrence = Number(sub.metadata?.pauseCount ?? 0) + 1;
    sub.autoRenew = false;
    sub.metadata = {
      ...(sub.metadata ?? {}),
      pauseCount: occurrence,
      pausedAt: new Date().toISOString(),
    };

    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Subscription ${subscriptionId} paused by user ${userId}`);

    await this.safeNotify(
      () =>
        this.notificationService.notifyPaused(saved, {
          tierName: sub.tier?.name,
          occurrence,
        }),
      `subscription paused ${saved.id}`,
    );

    return saved;
  }

  /**
   * Resume a paused subscription's auto-renewal.
   */
  async resumeSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<UserSubscription> {
    const sub = await this.getSubscriptionOrFail(subscriptionId);

    if (sub.userId !== userId) {
      throw new ForbiddenException('You do not own this subscription');
    }
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only active subscriptions can be resumed');
    }
    if (sub.autoRenew) {
      throw new BadRequestException('Subscription is not paused');
    }

    const occurrence = Number(sub.metadata?.resumeCount ?? 0) + 1;
    sub.autoRenew = true;
    sub.metadata = {
      ...(sub.metadata ?? {}),
      resumeCount: occurrence,
      resumedAt: new Date().toISOString(),
    };

    const saved = await this.subscriptionRepo.save(sub);
    this.logger.log(`Subscription ${subscriptionId} resumed by user ${userId}`);

    await this.safeNotify(
      () =>
        this.notificationService.notifyResumed(saved, {
          tierName: sub.tier?.name,
          occurrence,
        }),
      `subscription resumed ${saved.id}`,
    );

    return saved;
  }

  /**
   * Manually renew a subscription by providing a new Stellar tx hash.
   * (Also called by the auto-renewal scheduler job.)
   */
  async renewSubscription(
    subscriptionId: string,
    dto: RenewSubscriptionDto,
  ): Promise<UserSubscription> {
    const sub = await this.getSubscriptionOrFail(subscriptionId);
    const tier = await this.getTierOrFail(sub.tierId);

    if (!sub.autoRenew) {
      throw new BadRequestException('Auto-renewal is disabled for this subscription');
    }

    if (
      sub.status !== SubscriptionStatus.ACTIVE &&
      sub.status !== SubscriptionStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        `Cannot renew a subscription with status: ${sub.status}`,
      );
    }

    // Validate provider status and that the plan metadata is still current
    const providerProfile = await this.providerProfileService.loadProviderProfile(
      tier.providerId,
    );
    this.providerProfileService.assertProviderOperational(providerProfile);
    this.providerProfileService.assertPlanCurrent(tier, false);

    // Verify payment
    const verification = await this.paymentProcessor.verifySubscriptionPayment(
      dto.stellarTxHash,
      tier.price,
      sub.subscriberWallet,
      providerProfile.walletAddress || sub.providerWallet,
    );

    if (!verification.valid) {
      await this.recordFailedRenewal(sub, tier);
      throw new BadRequestException(`Renewal payment failed: ${verification.error}`);
    }

    // Successful renewal – extend period by 30 days from periodEnd (not now)
    const { platformCommission, providerEarnings } =
      this.paymentProcessor.calculateRevenueSplit(tier.price);

    const newPeriodStart = new Date(sub.periodEnd);
    const newPeriodEnd = new Date(
      newPeriodStart.getTime() + BILLING_CYCLE_DAYS * 86_400_000,
    );

    Object.assign(sub, {
      status: SubscriptionStatus.ACTIVE,
      paymentStatus: PaymentStatus.COMPLETED,
      stellarTxHash: dto.stellarTxHash,
      amountPaid: tier.price,
      platformCommission,
      providerEarnings,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      renewsAt: new Date(newPeriodEnd.getTime() - RENEWAL_NOTIFICATION_DAYS * 86_400_000),
      renewalCount: sub.renewalCount + 1,
      paymentFailureCount: 0,
      lastFailureReason: undefined,
    });

    const saved = await this.subscriptionRepo.save(sub);

    // Update tier total revenue
    const newTotal = new Big(tier.totalRevenue).plus(new Big(tier.price)).toFixed(7);
    await this.tierRepo.update(tier.id, { totalRevenue: newTotal });

    this.logger.log(`Subscription ${sub.id} renewed – period now ${newPeriodStart.toISOString()} → ${newPeriodEnd.toISOString()}`);

    await this.safeNotify(
      () => this.notificationService.notifyRenewed(saved, tier.name),
      `subscription renewed ${saved.id}`,
    );

    return saved;
  }

  /**
   * Record a failed renewal attempt, suspend the subscription once the retry
   * budget is exhausted, and emit exactly one subscriber notification.
   *
   * The reconciliation record and the notification deliberately exclude
   * payment secrets (transaction hashes, wallet addresses, raw provider
   * errors).
   */
  private async recordFailedRenewal(
    sub: UserSubscription,
    tier: SubscriptionTier,
  ): Promise<void> {
    sub.paymentFailureCount += 1;
    sub.paymentStatus = PaymentStatus.FAILED;

    const suspended = sub.paymentFailureCount >= MAX_PAYMENT_FAILURES;
    sub.lastFailureReason = suspended
      ? `Payment failed ${MAX_PAYMENT_FAILURES} times`
      : `Renewal payment failed (attempt ${sub.paymentFailureCount})`;

    if (suspended) {
      sub.status = SubscriptionStatus.SUSPENDED;
    }

    // Append a bounded, secret-free reconciliation record.
    const previousAttempts = Array.isArray(sub.metadata?.failedRenewalAttempts)
      ? (sub.metadata!.failedRenewalAttempts as Array<Record<string, unknown>>)
      : [];

    sub.metadata = {
      ...(sub.metadata ?? {}),
      failedRenewalAttempts: [
        ...previousAttempts,
        {
          attempt: sub.paymentFailureCount,
          reason: sub.lastFailureReason,
          at: new Date().toISOString(),
        },
      ].slice(-MAX_PAYMENT_FAILURES),
      lastFailedRenewalAt: new Date().toISOString(),
    };

    await this.subscriptionRepo.save(sub);

    if (suspended) {
      await this.accessControl.suspendSubscription(
        sub.id,
        `Payment failed ${MAX_PAYMENT_FAILURES} times`,
      );
      this.logger.warn(`Subscription ${sub.id} suspended after ${MAX_PAYMENT_FAILURES} failures`);
    }

    // One notification per failed attempt (duplicate events are suppressed).
    await this.safeNotify(
      () =>
        this.notificationService.notifyPaymentFailed(sub, {
          tierName: tier?.name,
          attempt: sub.paymentFailureCount,
          suspended,
        }),
      `subscription payment failed ${sub.id}`,
    );
  }

  /**
   * Run a notification callback without letting a delivery failure break the
   * subscription action that triggered it.
   */
  private async safeNotify(
    action: () => Promise<void>,
    context: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error: any) {
      this.logger.error(
        `Subscription notification failed (${context}): ${error?.message}`,
        error?.stack,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  QUERIES
  // ─────────────────────────────────────────────────────────────

  async getUserSubscriptions(userId: string): Promise<UserSubscription[]> {
    return this.subscriptionRepo.find({
      where: { userId },
      relations: ['tier'],
      order: { createdAt: 'DESC' },
    });
  }

  async getSubscriptionById(
    subscriptionId: string,
    userId?: string,
  ): Promise<UserSubscription> {
    const sub = await this.getSubscriptionOrFail(subscriptionId);
    if (userId && sub.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return sub;
  }

  /**
   * Revenue summary for a provider across all their tiers.
   */
  async getProviderRevenueSummary(providerId: string): Promise<{
    totalRevenue: string;
    platformCommissionPaid: string;
    netEarnings: string;
    activeSubscribers: number;
    tiers: Array<{
      tierId: string;
      tierName: string;
      activeSubscribers: number;
      totalRevenue: string;
    }>;
  }> {
    const tiers = await this.tierRepo.find({ where: { providerId } });

    let totalRevenue = new Big(0);
    let platformCommissionPaid = new Big(0);
    let netEarnings = new Big(0);
    let totalActiveSubscribers = 0;

    const tierSummaries = [];

    for (const tier of tiers) {
      const [, activeCount] = await this.subscriptionRepo.findAndCount({
        where: { tierId: tier.id, status: SubscriptionStatus.ACTIVE },
      });

      // Aggregate payments from db
      const result = await this.subscriptionRepo
        .createQueryBuilder('sub')
        .select('SUM(CAST(sub.amount_paid AS DECIMAL))', 'revenue')
        .addSelect('SUM(CAST(sub.platform_commission AS DECIMAL))', 'commission')
        .addSelect('SUM(CAST(sub.provider_earnings AS DECIMAL))', 'earnings')
        .where('sub.tierId = :tierId', { tierId: tier.id })
        .andWhere('sub.paymentStatus = :status', { status: PaymentStatus.COMPLETED })
        .getRawOne();

      const tierRevenue = new Big(result?.revenue ?? 0);
      const tierCommission = new Big(result?.commission ?? 0);
      const tierEarnings = new Big(result?.earnings ?? 0);

      totalRevenue = totalRevenue.plus(tierRevenue);
      platformCommissionPaid = platformCommissionPaid.plus(tierCommission);
      netEarnings = netEarnings.plus(tierEarnings);
      totalActiveSubscribers += activeCount;

      tierSummaries.push({
        tierId: tier.id,
        tierName: tier.name,
        activeSubscribers: activeCount,
        totalRevenue: tierRevenue.toFixed(7),
      });
    }

    return {
      totalRevenue: totalRevenue.toFixed(7),
      platformCommissionPaid: platformCommissionPaid.toFixed(7),
      netEarnings: netEarnings.toFixed(7),
      activeSubscribers: totalActiveSubscribers,
      tiers: tierSummaries,
    };
  }

  /**
   * Returns subscriptions that are due for renewal (used by scheduler).
   */
  async getSubscriptionsDueForRenewal(): Promise<UserSubscription[]> {
    const now = new Date();
    return this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.ACTIVE,
        autoRenew: true,
        renewsAt: LessThanOrEqual(now),
      },
      relations: ['tier'],
    });
  }

  /**
   * Returns subscriptions whose periodEnd has passed (used by scheduler).
   */
  async getExpiredSubscriptions(): Promise<UserSubscription[]> {
    const now = new Date();
    return this.subscriptionRepo.find({
      where: [
        { status: SubscriptionStatus.ACTIVE, periodEnd: LessThanOrEqual(now) },
        { status: SubscriptionStatus.SUSPENDED, periodEnd: LessThanOrEqual(now) },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────────

  private async getTierOrFail(tierId: string): Promise<SubscriptionTier> {
    const tier = await this.tierRepo.findOne({
      where: { id: tierId },
      relations: ['provider'],
    });
    if (!tier) throw new NotFoundException(`Subscription tier ${tierId} not found`);
    return tier;
  }

  private async getSubscriptionOrFail(id: string): Promise<UserSubscription> {
    const sub = await this.subscriptionRepo.findOne({
      where: { id },
      relations: ['tier'],
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return sub;
  }

  /**
   * Capture the tier fields that are relevant to existing subscribers so the
   * pre-update values survive `Object.assign` / `save`.
   */
  private snapshotTier(tier: SubscriptionTier): TierSnapshot {
    return {
      providerId: tier.providerId,
      name: tier.name,
      price: tier.price,
      benefits: [...(tier.benefits ?? [])],
      active: tier.active,
      acceptingNewSubscribers: tier.acceptingNewSubscribers,
      signalLimit: tier.signalLimit ?? null,
    };
  }

  /**
   * Notify affected subscribers without letting a notification failure break
   * the (already committed) tier change.
   */
  private async notifySubscribersOfChange(
    tierId: string,
    before: TierSnapshot,
    after: TierSnapshot,
    options: { userIds?: string[]; force?: boolean } = {},
  ): Promise<void> {
    try {
      await this.changeNotifier.notifyAffectedSubscribers(
        tierId,
        before,
        after,
        options,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify subscribers about changes to tier ${tierId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
