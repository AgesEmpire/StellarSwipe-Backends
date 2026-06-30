import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CacheService, CachePrefix } from './cache.service';
import { Signal } from '../signals/entities/signal.entity';

@Injectable()
export class CacheReconciliationJob {
  private readonly logger = new Logger(CacheReconciliationJob.name);
  private readonly sampleRate: number;
  private readonly intervalMs: number;

  constructor(
    private readonly cacheService: CacheService,
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
    private readonly configService: ConfigService,
  ) {
    this.sampleRate = this.configService.get<number>('cache.reconciliation.sampleRate', 0.1);
    this.intervalMs = this.configService.get<number>('cache.reconciliation.intervalMs', 60000);
  }

  @Cron('0 * * * * *') // every minute; overridden by intervalMs config conceptually
  async reconcile(): Promise<void> {
    this.logger.log(`Starting cache reconciliation (sampleRate=${this.sampleRate})`);

    const signals = await this.signalRepo.find({ take: 500, order: { updatedAt: 'DESC' } });
    const sample = signals.filter(() => Math.random() < this.sampleRate);

    let mismatches = 0;
    for (const dbRow of sample) {
      const key = `${CachePrefix.SIGNAL}${dbRow.id}`;
      const cached = await this.cacheService.get<Signal>(key);
      if (cached === undefined || cached === null) continue;

      if (cached.status !== dbRow.status || cached.updatedAt?.toString() !== dbRow.updatedAt?.toString()) {
        mismatches++;
        this.logger.warn(`Cache mismatch detected for key=${key}: cached.status=${cached.status} db.status=${dbRow.status}`);
        await this.cacheService.del(key);
      }
    }

    this.logger.log(`Reconciliation complete: sampled=${sample.length}, mismatches=${mismatches}`);
  }
}
