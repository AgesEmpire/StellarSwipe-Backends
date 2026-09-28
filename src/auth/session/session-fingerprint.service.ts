import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';

import { LoginFingerprint } from './entities/login-fingerprint.entity';
import { LoginSignals } from './dto/login-signals.dto';

export const SESSION_FINGERPRINT_EVENTS = {
  ANOMALOUS_LOGIN: 'session_fingerprint.anomalous_login',
};

export interface FingerprintCheckResult {
  fingerprintHash: string;
  /** True when this fingerprint was NOT found in the user's recent history. */
  anomalous: boolean;
}

/**
 * Computes a hash of login signals (IP + user-agent + optional
 * accept-language) and compares it against a user's recent login
 * history to flag logins from devices/networks not seen recently.
 */
@Injectable()
export class SessionFingerprintService {
  private readonly logger = new Logger(SessionFingerprintService.name);

  /** How many days of history count as "recent" when comparing fingerprints. */
  private readonly historyWindowDays: number;
  /** How many recent fingerprints to retain per user (best-effort cap). */
  private readonly maxFingerprintsPerUser: number;

  constructor(
    @InjectRepository(LoginFingerprint)
    private readonly fingerprintRepo: Repository<LoginFingerprint>,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.historyWindowDays = this.configService.get<number>(
      'auth.fingerprintHistoryWindowDays',
      30,
    );
    this.maxFingerprintsPerUser = this.configService.get<number>(
      'auth.maxFingerprintsPerUser',
      20,
    );
  }

  /**
   * Compute a stable SHA-256 hash from the login signals. IP and
   * user-agent are normalized (lower-cased/trimmed) so trivial casing
   * differences don't generate spurious "new" fingerprints.
   */
  computeFingerprint(signals: LoginSignals): string {
    const normalized = [
      (signals.ipAddress ?? '').trim().toLowerCase(),
      (signals.userAgent ?? '').trim().toLowerCase(),
      (signals.acceptLanguage ?? '').trim().toLowerCase(),
    ].join('|');

    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Record a successful login's fingerprint and determine whether it
   * matches the user's recent history. Emits an event (and logs) when
   * the fingerprint is new/anomalous so other parts of the app (e.g.
   * notifications) can react.
   */
  async checkAndRecord(
    userId: string,
    signals: LoginSignals,
  ): Promise<FingerprintCheckResult> {
    const fingerprintHash = this.computeFingerprint(signals);
    const anomalous = !(await this.isKnownFingerprint(userId, fingerprintHash));

    await this.persistFingerprint(userId, fingerprintHash, signals);

    if (anomalous) {
      this.logger.warn(
        `Anomalous login detected for user ${userId}: fingerprint ${fingerprintHash} not seen in last ${this.historyWindowDays}d`,
      );
      this.eventEmitter.emit(SESSION_FINGERPRINT_EVENTS.ANOMALOUS_LOGIN, {
        userId,
        fingerprintHash,
        ipAddress: signals.ipAddress,
        userAgent: signals.userAgent,
        occurredAt: new Date(),
      });
    } else {
      this.logger.debug(
        `Known fingerprint for user ${userId}: ${fingerprintHash}`,
      );
    }

    return { fingerprintHash, anomalous };
  }

  /**
   * Whether the given fingerprint hash has been seen for this user
   * within the recent history window.
   */
  async isKnownFingerprint(
    userId: string,
    fingerprintHash: string,
  ): Promise<boolean> {
    const since = this.windowStart();
    const match = await this.fingerprintRepo.findOne({
      where: {
        userId,
        fingerprintHash,
        createdAt: MoreThanOrEqual(since),
      },
    });
    return !!match;
  }

  /** Recent fingerprints for a user, most recent first. */
  async getRecentFingerprints(userId: string): Promise<LoginFingerprint[]> {
    const since = this.windowStart();
    return this.fingerprintRepo.find({
      where: { userId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
      take: this.maxFingerprintsPerUser,
    });
  }

  private async persistFingerprint(
    userId: string,
    fingerprintHash: string,
    signals: LoginSignals,
  ): Promise<LoginFingerprint> {
    const entry = this.fingerprintRepo.create({
      userId,
      fingerprintHash,
      ipAddress: signals.ipAddress,
      userAgent: signals.userAgent,
      acceptLanguage: signals.acceptLanguage,
    });
    return this.fingerprintRepo.save(entry);
  }

  private windowStart(): Date {
    const since = new Date();
    since.setDate(since.getDate() - this.historyWindowDays);
    return since;
  }
}
