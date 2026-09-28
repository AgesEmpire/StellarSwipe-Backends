import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DuplicateCheckDto, DuplicateCheckResultDto } from './dto/duplicate-check.dto';
import { calculatePayloadFingerprint } from './utils/hash-calculator';

interface SeenTransaction {
  fingerprint: string;
  firstSeenAt: Date;
  expiresAt: Date;
  transactionId: string;
  accountId?: string;
}

@Injectable()
export class DuplicateDetectorService {
  private readonly logger = new Logger(DuplicateDetectorService.name);
  private readonly seenTransactions = new Map<string, SeenTransaction>();
  private readonly windowMs: number;

  constructor(private readonly configService?: ConfigService) {
    const fromEnv = this.configService?.get<string>('TRANSACTION_DUPLICATE_WINDOW_MS');
    this.windowMs = this.configService?.get<number>(
      'transactions.duplicateWindowMs',
      Number(fromEnv ?? 300_000),
    ) ?? Number(fromEnv ?? 300_000);
  }

  checkTransaction(dto: DuplicateCheckDto, now = new Date()): DuplicateCheckResultDto {
    this.removeExpired(now);

    const fingerprint = calculatePayloadFingerprint({
      accountId: dto.accountId,
      payload: dto.payload,
    });
    const existing = this.seenTransactions.get(fingerprint);

    if (existing && existing.expiresAt.getTime() > now.getTime()) {
      const reason = `Duplicate transaction payload detected within ${this.windowMs}ms window`;
      this.logger.warn(`${reason}: ${dto.transactionId}`);

      return {
        accepted: false,
        duplicate: true,
        fingerprint,
        reason,
        firstSeenAt: existing.firstSeenAt,
        expiresAt: existing.expiresAt,
      };
    }

    const record: SeenTransaction = {
      fingerprint,
      firstSeenAt: now,
      expiresAt: new Date(now.getTime() + this.windowMs),
      transactionId: dto.transactionId,
      accountId: dto.accountId,
    };

    this.seenTransactions.set(fingerprint, record);

    return {
      accepted: true,
      duplicate: false,
      fingerprint,
      firstSeenAt: record.firstSeenAt,
      expiresAt: record.expiresAt,
    };
  }

  getWindowMs(): number {
    return this.windowMs;
  }

  clear(): void {
    this.seenTransactions.clear();
  }

  private removeExpired(now: Date): void {
    for (const [fingerprint, record] of this.seenTransactions.entries()) {
      if (record.expiresAt.getTime() <= now.getTime()) {
        this.seenTransactions.delete(fingerprint);
      }
    }
  }
}
