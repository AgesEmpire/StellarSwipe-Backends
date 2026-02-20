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
import { CreateTierDto, UpdateTierDto } from './dto/create-tier.dto';
import {
  SubscribeDto,
  CancelSubscriptionDto,
  RenewSubscriptionDto,
} from './dto/subscribe.dto';
import { User } from '../users/entities/user.entity';

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
    private readonly dataSource: DataSource,
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

    return this.tierRepo.save(tier);
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

    await this.dataSource.transaction(async (manager) => {
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
    });

    this.logger.log(`Tier ${tierId} cancelled by provider ${providerId}`);
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

    if (!tier.active || !tier.acceptingNewSubscribers) {
      throw new BadRequestException(
        'This subscription tier is not currently accepting new subscribers',
      );
    }

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
      // Load provider wallet from their user record
      const providerUser = await this.tierRepo.manager.findOne(User, {
        where: { id: tier.providerId },
      });

      const providerWallet = providerUser?.walletAddress;

      if (!providerWallet) {
        throw new BadRequestException('Provider wallet not found');
      }

      const verification = await this.paymentProcessor.verifySubscriptionPayment(
        dto.stellarTxHash,
        tier.price,
        dto.subscriberWallet,
        providerWallet,
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

    return this.dataSource.transaction(async (manager) => {
      // Find and cache provider wallet for future renewals
      const providerUser = await manager.findOne(User, {
        where: { id: tier.providerId },
      });

      const subscription = manager.create(UserSubscription, {
        userId,
        tierId: tier.id,
        providerId: tier.providerId,
        status:
          tier.level === TierLevel.FREE
            ? SubscriptionStatus.ACTIVE
            : SubscriptionStatus.ACTIVE,
        amountPaid: tier.price,
        platformCommission,
        providerEarnings,
        stellarTxHash: tier.level === TierLevel.FREE ? undefined : dto.stellarTxHash,
        paymentStatus: PaymentStatus.COMPLETED,
        periodStart: now,
        periodEnd,
        renewsAt: new Date(periodEnd.getTime() - RENEWAL_NOTIFICATION_DAYS * 86_400_000),
        subscriberWallet: dto.subscriberWallet,
        providerWallet: providerUser?.walletAddress ?? '',
        autoRenew: dto.autoRenew ?? true,
        renewalCount: 0,
        paymentFailureCount: 0,
      });

      const saved = await manager.save(UserSubscription, subscription);

      // Increment subscriber count and accumulate revenue on the tier
      const newTotal = new Big(tier.totalRevenue).plus(new Big(tier.price)).toFixed(7);
      await manager.update(SubscriptionTier, tier.id, {
        subscriberCount: () => '"subscriber_count" + 1',
        totalRevenue: newTotal,
      });

      this.logger.log(
        `User ${userId} subscribed to tier ${tier.id} (${tier.name}) – sub id: ${saved.id}`,
      );

      return saved;
    });
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

    // Verify payment
    const verification = await this.paymentProcessor.verifySubscriptionPayment(
      dto.stellarTxHash,
      tier.price,
      sub.subscriberWallet,
      sub.providerWallet,
    );

    if (!verification.valid) {
      // Increment failure count
      sub.paymentFailureCount += 1;
      sub.lastFailureReason = verification.error;
      sub.paymentStatus = PaymentStatus.FAILED;

      if (sub.paymentFailureCount >= MAX_PAYMENT_FAILURES) {
        sub.status = SubscriptionStatus.SUSPENDED;
        await this.accessControl.suspendSubscription(
          sub.id,
          `Payment failed ${MAX_PAYMENT_FAILURES} times`,
        );
        this.logger.warn(`Subscription ${sub.id} suspended after ${MAX_PAYMENT_FAILURES} failures`);
      }

      await this.subscriptionRepo.save(sub);
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
    return saved;
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
}
