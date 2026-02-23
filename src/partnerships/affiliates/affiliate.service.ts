import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Affiliate, AffiliateStatus } from './entities/affiliate.entity';
import { AffiliateConversion, ConversionStatus, ConversionType } from './entities/affiliate-conversion.entity';
import { CreateAffiliateDto } from './dto/create-affiliate.dto';
import { TrackConversionDto } from './dto/track-conversion.dto';
import { AffiliateStatsDto } from './dto/affiliate-stats.dto';

@Injectable()
export class AffiliateService {
  private readonly DEFAULT_COMMISSION_RATES = {
    tier1: 10, // 10% for direct referrals
    tier2: 5,  // 5% for second level
    tier3: 2,  // 2% for third level
  };

  constructor(
    @InjectRepository(Affiliate)
    private affiliateRepository: Repository<Affiliate>,
    @InjectRepository(AffiliateConversion)
    private conversionRepository: Repository<AffiliateConversion>,
  ) {}

  async createAffiliate(dto: CreateAffiliateDto): Promise<Affiliate> {
    const existingAffiliate = await this.affiliateRepository.findOne({
      where: { userId: dto.userId },
    });

    if (existingAffiliate) {
      throw new BadRequestException('User is already an affiliate');
    }

    let parentAffiliate = null;
    let level = 1;

    if (dto.parentAffiliateCode) {
      parentAffiliate = await this.affiliateRepository.findOne({
        where: { affiliateCode: dto.parentAffiliateCode },
      });

      if (!parentAffiliate) {
        throw new NotFoundException('Parent affiliate not found');
      }

      if (parentAffiliate.level >= 3) {
        throw new BadRequestException('Maximum affiliate level reached');
      }

      level = parentAffiliate.level + 1;
    }

    const affiliateCode = this.generateAffiliateCode();

    const affiliate = this.affiliateRepository.create({
      userId: dto.userId,
      affiliateCode,
      status: AffiliateStatus.ACTIVE,
      parentAffiliateId: parentAffiliate?.id,
      level,
      commissionRates: this.DEFAULT_COMMISSION_RATES,
      payoutDetails: dto.payoutDetails,
    });

    return this.affiliateRepository.save(affiliate);
  }

  async getAffiliateByCode(code: string): Promise<Affiliate> {
    const affiliate = await this.affiliateRepository.findOne({
      where: { affiliateCode: code },
    });

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    return affiliate;
  }

  async getAffiliateByUserId(userId: string): Promise<Affiliate> {
    const affiliate = await this.affiliateRepository.findOne({
      where: { userId },
    });

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    return affiliate;
  }

  async trackConversion(dto: TrackConversionDto): Promise<AffiliateConversion[]> {
    const affiliate = await this.getAffiliateByCode(dto.affiliateCode);

    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new BadRequestException('Affiliate is not active');
    }

    const conversions: AffiliateConversion[] = [];
    const affiliateChain = await this.getAffiliateChain(affiliate);

    for (let i = 0; i < affiliateChain.length && i < 3; i++) {
      const currentAffiliate = affiliateChain[i];
      const tier = i + 1;
      const commissionRate = this.getCommissionRate(currentAffiliate, tier);
      const commissionAmount = (dto.conversionValue * commissionRate) / 100;

      const conversion = this.conversionRepository.create({
        affiliateId: currentAffiliate.id,
        referredUserId: dto.referredUserId,
        conversionType: dto.conversionType,
        conversionValue: dto.conversionValue,
        commissionAmount,
        commissionRate,
        tier,
        status: ConversionStatus.PENDING,
        metadata: dto.metadata,
      });

      const savedConversion = await this.conversionRepository.save(conversion);
      conversions.push(savedConversion);

      currentAffiliate.totalReferrals += tier === 1 ? 1 : 0;
      currentAffiliate.pendingCommission += commissionAmount;
      await this.affiliateRepository.save(currentAffiliate);
    }

    return conversions;
  }

  async approveConversion(conversionId: string): Promise<AffiliateConversion> {
    const conversion = await this.conversionRepository.findOne({
      where: { id: conversionId },
    });

    if (!conversion) {
      throw new NotFoundException('Conversion not found');
    }

    if (conversion.status !== ConversionStatus.PENDING) {
      throw new BadRequestException('Conversion is not pending');
    }

    conversion.status = ConversionStatus.APPROVED;
    conversion.approvedAt = new Date();

    return this.conversionRepository.save(conversion);
  }

  async getAffiliateStats(affiliateId: string): Promise<AffiliateStatsDto> {
    const affiliate = await this.affiliateRepository.findOne({
      where: { id: affiliateId },
    });

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const conversions = await this.conversionRepository.find({
      where: { affiliateId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const tierBreakdown = {
      tier1: { count: 0, earnings: 0 },
      tier2: { count: 0, earnings: 0 },
      tier3: { count: 0, earnings: 0 },
    };

    conversions.forEach(conv => {
      const tierKey = `tier${conv.tier}` as keyof typeof tierBreakdown;
      tierBreakdown[tierKey].count++;
      tierBreakdown[tierKey].earnings += Number(conv.commissionAmount);
    });

    const totalConversions = conversions.length;
    const conversionRate = affiliate.totalReferrals > 0 
      ? (totalConversions / affiliate.totalReferrals) * 100 
      : 0;

    return {
      totalEarnings: Number(affiliate.totalEarnings),
      pendingCommission: Number(affiliate.pendingCommission),
      paidCommission: Number(affiliate.paidCommission),
      totalReferrals: affiliate.totalReferrals,
      activeReferrals: affiliate.activeReferrals,
      conversionRate,
      tierBreakdown,
      recentConversions: conversions.slice(0, 5),
    };
  }

  async processPayout(affiliateId: string): Promise<{ success: boolean; amount: number }> {
    const affiliate = await this.affiliateRepository.findOne({
      where: { id: affiliateId },
    });

    if (!affiliate) {
      throw new NotFoundException('Affiliate not found');
    }

    const pendingAmount = Number(affiliate.pendingCommission);

    if (pendingAmount <= 0) {
      throw new BadRequestException('No pending commission to payout');
    }

    const approvedConversions = await this.conversionRepository.find({
      where: { 
        affiliateId, 
        status: ConversionStatus.APPROVED 
      },
    });

    for (const conversion of approvedConversions) {
      conversion.status = ConversionStatus.PAID;
      conversion.paidAt = new Date();
      await this.conversionRepository.save(conversion);
    }

    affiliate.paidCommission = Number(affiliate.paidCommission) + pendingAmount;
    affiliate.pendingCommission = 0;
    affiliate.lastPayoutDate = new Date();
    await this.affiliateRepository.save(affiliate);

    return { success: true, amount: pendingAmount };
  }

  async getPartnerDashboard(userId: string) {
    const affiliate = await this.getAffiliateByUserId(userId);
    const stats = await this.getAffiliateStats(affiliate.id);

    const referralLink = `${process.env.APP_URL}/signup?ref=${affiliate.affiliateCode}`;

    return {
      affiliate: {
        id: affiliate.id,
        code: affiliate.affiliateCode,
        status: affiliate.status,
        level: affiliate.level,
        referralLink,
      },
      stats,
      commissionRates: affiliate.commissionRates,
      payoutDetails: affiliate.payoutDetails,
    };
  }

  private async getAffiliateChain(affiliate: Affiliate): Promise<Affiliate[]> {
    const chain: Affiliate[] = [affiliate];

    let currentAffiliate = affiliate;
    while (currentAffiliate.parentAffiliateId && chain.length < 3) {
      const parent = await this.affiliateRepository.findOne({
        where: { id: currentAffiliate.parentAffiliateId },
      });

      if (!parent) break;

      chain.push(parent);
      currentAffiliate = parent;
    }

    return chain;
  }

  private getCommissionRate(affiliate: Affiliate, tier: number): number {
    const rates = affiliate.commissionRates || this.DEFAULT_COMMISSION_RATES;
    const tierKey = `tier${tier}` as keyof typeof rates;
    return rates[tierKey] || 0;
  }

  private generateAffiliateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
