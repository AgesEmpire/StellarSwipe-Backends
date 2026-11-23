import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { Signal } from '../../signals/entities/signal.entity';
import { AuditLog } from '../../audit-log/audit-log.entity';

const AUDIT_LOG_LIMIT = 1000;

@Injectable()
export class UserDataExporterService {
  private readonly logger = new Logger(UserDataExporterService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Trade) private tradeRepo: Repository<Trade>,
    @InjectRepository(Signal) private signalRepo: Repository<Signal>,
    @InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>,
  ) {}

  async exportUserData(userId: string, startDate?: Date, endDate?: Date): Promise<any> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const dateFilter = startDate && endDate ? Between(startDate, endDate) : undefined;
    const exclusions: { category: string; reason: string }[] = [];

    const [tradesResult, signalsResult, auditResult] = await Promise.allSettled([
      this.tradeRepo.find({
        where: { userId, ...(dateFilter && { createdAt: dateFilter }) },
        order: { createdAt: 'DESC' },
      }),
      this.signalRepo.find({
        where: { providerId: userId, ...(dateFilter && { createdAt: dateFilter }) },
        order: { createdAt: 'DESC' },
      }),
      this.auditRepo.find({
        where: { userId, ...(dateFilter && { createdAt: dateFilter }) },
        order: { createdAt: 'DESC' },
        take: AUDIT_LOG_LIMIT,
      }),
    ]);

    // A failed category is excluded on its own; the rest of the export still ships.
    const settle = <T>(result: PromiseSettledResult<T[]>, category: string): T[] => {
      if (result.status === 'fulfilled') return result.value;
      this.logger.error(`Export category ${category} failed for user ${userId}`, result.reason?.stack);
      exclusions.push({ category, reason: 'unavailable' });
      return [];
    };

    const trades = settle(tradesResult, 'trades');
    const signals = settle(signalsResult, 'signals');
    const auditLogs = settle(auditResult, 'auditLog');
    if (auditResult.status === 'fulfilled' && auditLogs.length >= AUDIT_LOG_LIMIT) {
      exclusions.push({ category: 'auditLog', reason: 'row_limit_reached' });
    }

    const exportedAt = new Date().toISOString();

    return {
      user: {
        walletAddress: user.walletAddress,
        createdAt: user.createdAt,
        kycStatus: user.kycStatus,
        tier: user.tier,
      },
      trades: trades.map((t) => ({
        id: t.id,
        date: t.createdAt,
        assetPair: `${t.baseAsset}/${t.counterAsset}`,
        amount: t.amount,
        price: t.entryPrice,
        side: t.side,
        status: t.status,
        pnl: t.profitLoss,
      })),
      signals: signals.map((s) => ({
        id: s.id,
        date: s.createdAt,
        assetPair: `${s.baseAsset}/${s.counterAsset}`,
        direction: s.type,
        entryPrice: s.entryPrice,
        targetPrice: s.targetPrice,
        stopLoss: s.stopLossPrice,
        status: s.status,
      })),
      auditLog: auditLogs.map((a) => ({
        action: a.action,
        timestamp: a.createdAt,
        ipAddress: a.ipAddress,
        status: a.status,
      })),
      manifest: {
        generatedAt: exportedAt,
        categories: [
          { name: 'profile', count: 1 },
          { name: 'trades', count: trades.length },
          { name: 'signals', count: signals.length },
          { name: 'auditLog', count: auditLogs.length },
        ],
        exclusions,
      },
      exportedAt,
    };
  }
}
