import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { Signal } from '../../signals/entities/signal.entity';
import { AuditLog } from '../../audit-log/audit-log.entity';

@Injectable()
export class UserDataExporterService {
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

    const [trades, signals, auditLogs] = await Promise.all([
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
        take: 1000,
      }),
    ]);

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
      exportedAt: new Date().toISOString(),
    };
  }
}
