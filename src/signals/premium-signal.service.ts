import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal } from './entities/signal.entity';
import { PremiumSubscription, SubscriptionStatus } from './entities/premium-subscription.entity';
import { SubscribePremiumDto, UpdatePremiumSignalDto } from './dto/premium-signal.dto';

@Injectable()
export class PremiumSignalService {
  constructor(
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    @InjectRepository(PremiumSubscription)
    private readonly subscriptionRepo: Repository<PremiumSubscription>,
  ) {}

  async isSubscribed(userId: string, providerId: string): Promise<boolean> {
    const sub = await this.subscriptionRepo.findOne({
      where: { userId, providerId, status: SubscriptionStatus.ACTIVE },
    });
    if (!sub) return false;
    if (sub.expiresAt && sub.expiresAt < new Date()) {
      sub.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(sub);
      return false;
    }
    return true;
  }

  async subscribe(userId: string, dto: SubscribePremiumDto): Promise<PremiumSubscription> {
    const existing = await this.subscriptionRepo.findOne({
      where: { userId, providerId: dto.providerId },
    });

    if (existing) {
      existing.status = SubscriptionStatus.ACTIVE;
      existing.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
      existing.paymentReference = dto.paymentReference;
      existing.amountPaid = dto.amountPaid?.toString();
      existing.currency = dto.currency;
      return this.subscriptionRepo.save(existing);
    }

    const sub = this.subscriptionRepo.create({
      userId,
      providerId: dto.providerId,
      status: SubscriptionStatus.ACTIVE,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      paymentReference: dto.paymentReference,
      amountPaid: dto.amountPaid?.toString(),
      currency: dto.currency,
    });
    return this.subscriptionRepo.save(sub);
  }

  async updateSignalPremiumStatus(
    signalId: string,
    requestingUserId: string,
    dto: UpdatePremiumSignalDto,
  ): Promise<Signal> {
    const signal = await this.signalRepo.findOne({ where: { id: signalId } });
    if (!signal) throw new NotFoundException(`Signal ${signalId} not found`);
    if (signal.providerId !== requestingUserId) throw new ForbiddenException('Only the signal provider can update premium status');

    if (dto.isPremium !== undefined) signal.isPremium = dto.isPremium;
    if (dto.premiumPrice !== undefined) signal.premiumPrice = dto.premiumPrice.toString();
    if (dto.premiumCurrency !== undefined) signal.premiumCurrency = dto.premiumCurrency;

    return this.signalRepo.save(signal);
  }

  /** Strip restricted fields from premium signals for non-subscribers */
  sanitizeForNonSubscriber(signal: Signal): Partial<Signal> {
    const { entryPrice: _e, targetPrice: _t, stopLossPrice: _s, rationale: _r, metadata: _m, ...safe } = signal;
    return {
      ...safe,
      entryPrice: undefined as any,
      targetPrice: undefined as any,
      stopLossPrice: undefined as any,
      rationale: null,
      metadata: { premiumLocked: true },
    };
  }

  async getSignalForUser(signalId: string, userId: string): Promise<Partial<Signal>> {
    const signal = await this.signalRepo.findOne({ where: { id: signalId } });
    if (!signal) throw new NotFoundException(`Signal ${signalId} not found`);

    if (!signal.isPremium) return signal;

    const subscribed = await this.isSubscribed(userId, signal.providerId);
    if (subscribed) return signal;

    return this.sanitizeForNonSubscriber(signal);
  }

  async getFeedForUser(userId: string): Promise<Partial<Signal>[]> {
    const signals = await this.signalRepo.find({
      order: { isPremium: 'DESC', confidenceScore: 'DESC', createdAt: 'DESC' },
      take: 100,
    });

    return Promise.all(
      signals.map(async (s) => {
        if (!s.isPremium) return s;
        const subscribed = await this.isSubscribed(userId, s.providerId);
        return subscribed ? s : this.sanitizeForNonSubscriber(s);
      }),
    );
  }

  async getSubscriptions(userId: string): Promise<PremiumSubscription[]> {
    return this.subscriptionRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}
