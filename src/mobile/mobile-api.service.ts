import { Injectable } from '@nestjs/common';
import { PayloadOptimizerService } from './services/payload-optimizer.service';
import { DeltaSyncService } from './services/delta-sync.service';
import { PushTokenManagerService } from './services/push-token-manager.service';
import { CompactSignalDto } from './dto/mobile-feed.dto';
import { MobilePortfolioDto } from './dto/mobile-portfolio.dto';
import { BatchRequestDto, BatchResponseItem } from './dto/batch-request.dto';
import { DeltaSyncResult } from './interfaces/offline-sync.interface';

@Injectable()
export class MobileApiService {
  constructor(
    private readonly optimizer: PayloadOptimizerService,
    private readonly deltaSync: DeltaSyncService,
    private readonly pushTokenManager: PushTokenManagerService,
  ) {}

  getFeed(syncToken?: string): DeltaSyncResult<CompactSignalDto> {
    // Stub: replace with real signal query
    const signals: (CompactSignalDto & { updatedAt: Date; deletedAt?: null })[] = [];
    return this.deltaSync.computeDelta(signals, syncToken);
  }

  getPortfolio(userId: string): MobilePortfolioDto {
    // Stub: replace with real portfolio query
    void userId;
    return this.optimizer.optimize({
      bal: 0,
      pnl: 0,
      pnlPct: 0,
      pos: [],
      ts: Date.now(),
    }) as MobilePortfolioDto;
  }

  async processBatch(dto: BatchRequestDto): Promise<BatchResponseItem[]> {
    return dto.requests.map((req) => ({
      id: req.id,
      status: 200,
      body: { path: req.path, data: null },
    }));
  }

  registerPushToken(userId: string, token: string, platform: 'ios' | 'android'): void {
    this.pushTokenManager.register(userId, token, platform);
  }

  deregisterPushToken(token: string): void {
    this.pushTokenManager.deregister(token);
  }
}
