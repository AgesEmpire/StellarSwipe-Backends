import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Trade } from '../trades/entities/trade.entity';
import { Signal } from '../signals/entities/signal.entity';
import {
  SocialExportRequestDto,
  SocialExportPayload,
  SocialPlatform,
} from './social-export.dto';

@Injectable()
export class SocialExportService {
  private readonly logger = new Logger(SocialExportService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    private readonly config: ConfigService,
  ) {
    this.appUrl = this.config.get<string>('APP_URL', 'https://stellarswipe.io');
  }

  async generateExport(
    tradeId: string,
    dto: SocialExportRequestDto,
  ): Promise<SocialExportPayload> {
    const trade = await this.tradeRepo.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException(`Trade ${tradeId} not found`);

    const signal = await this.signalRepo.findOne({
      where: { id: trade.signalId },
      relations: ['provider'],
    });

    const platform = dto.platform ?? SocialPlatform.GENERIC;
    const pair = `${trade.baseAsset}/${trade.counterAsset}`;
    const pnlPercent = trade.profitLossPercentage
      ? parseFloat(trade.profitLossPercentage).toFixed(2)
      : '0.00';
    const pnlValue = parseFloat(pnlPercent);
    const pnlDirection: SocialExportPayload['pnlDirection'] =
      pnlValue > 0 ? 'profit' : pnlValue < 0 ? 'loss' : 'neutral';

    const providerHandle = signal?.provider?.username
      ? `@${signal.provider.username}`
      : '@StellarSwipe';

    const headline = this.buildHeadline(pair, pnlPercent, pnlDirection, trade.side);
    const shareText = this.buildShareText(headline, providerHandle, tradeId, platform);

    const payload: SocialExportPayload = {
      headline,
      pair,
      side: trade.side,
      pnlPercent,
      pnlDirection,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice ?? null,
      outcome: trade.status,
      providerHandle,
      attribution: `Signal by ${providerHandle} on StellarSwipe`,
      shareText,
      platform,
      generatedAt: new Date().toISOString(),
    };

    this.logger.log(`Social export generated for trade ${tradeId} on platform ${platform}`);
    return payload;
  }

  private buildHeadline(
    pair: string,
    pnlPercent: string,
    direction: SocialExportPayload['pnlDirection'],
    side: string,
  ): string {
    const emoji = direction === 'profit' ? '🚀' : direction === 'loss' ? '📉' : '➡️';
    const sign = direction === 'profit' ? '+' : '';
    return `${emoji} ${side.toUpperCase()} ${pair} ${sign}${pnlPercent}%`;
  }

  private buildShareText(
    headline: string,
    providerHandle: string,
    tradeId: string,
    platform: SocialPlatform,
  ): string {
    const tradeUrl = `${this.appUrl}/trades/${tradeId}`;
    const base = `${headline}\n\nCopy top traders on Stellar with StellarSwipe.\nSignal by ${providerHandle}\n${tradeUrl}`;

    if (platform === SocialPlatform.TWITTER) {
      return `${base}\n\n#StellarSwipe #DeFi #Stellar`;
    }
    return base;
  }
}
