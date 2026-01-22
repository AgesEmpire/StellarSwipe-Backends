import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, In } from 'typeorm';
import {
  Signal,
  SignalStatus,
  SignalOutcome,
} from '../entities/signal.entity';
import {
  CopiedPosition,
  PositionStatus,
} from '../entities/copied-position.entity';

export interface ExpirationCheckResult {
  signalId: string;
  isExpired: boolean;
  isInGracePeriod: boolean;
  gracePeriodEndsAt: Date | null;
  openPositionsCount: number;
}

export interface ExpiredSignalsSummary {
  checkedAt: Date;
  totalExpired: number;
  totalInGracePeriod: number;
  signals: ExpirationCheckResult[];
}

@Injectable()
export class SignalExpirationService {
  private readonly logger = new Logger(SignalExpirationService.name);

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(CopiedPosition)
    private positionRepository: Repository<CopiedPosition>,
  ) {}

  async findExpiredSignals(): Promise<Signal[]> {
    const now = new Date();
    return this.signalRepository.find({
      where: {
        status: SignalStatus.ACTIVE,
        expiresAt: LessThanOrEqual(now),
      },
      relations: ['copiedPositions'],
    });
  }

  async findSignalsInGracePeriod(): Promise<Signal[]> {
    const now = new Date();
    return this.signalRepository.find({
      where: {
        status: SignalStatus.EXPIRED,
        outcome: SignalOutcome.EXPIRED,
        gracePeriodEndsAt: LessThanOrEqual(now),
      },
      relations: ['copiedPositions'],
    });
  }

  async findSignalsApproachingExpiration(
    minutesBefore: number,
  ): Promise<Signal[]> {
    const now = new Date();
    const threshold = new Date(now.getTime() + minutesBefore * 60 * 1000);

    const signals = await this.signalRepository
      .createQueryBuilder('signal')
      .where('signal.status = :status', { status: SignalStatus.ACTIVE })
      .andWhere('signal.expiresAt <= :threshold', { threshold })
      .andWhere('signal.expiresAt > :now', { now })
      .leftJoinAndSelect('signal.copiedPositions', 'positions')
      .getMany();

    return signals;
  }

  async checkSignalExpiration(signalId: string): Promise<ExpirationCheckResult> {
    const signal = await this.signalRepository.findOne({
      where: { id: signalId },
      relations: ['copiedPositions'],
    });

    if (!signal) {
      throw new Error(`Signal ${signalId} not found`);
    }

    const now = new Date();
    const isExpired = signal.expiresAt <= now;
    const isInGracePeriod =
      signal.gracePeriodEndsAt !== null &&
      signal.gracePeriodEndsAt > now &&
      isExpired;

    const openPositionsCount = signal.copiedPositions?.filter(
      (p) => p.status === PositionStatus.OPEN,
    ).length ?? 0;

    return {
      signalId: signal.id,
      isExpired,
      isInGracePeriod,
      gracePeriodEndsAt: signal.gracePeriodEndsAt,
      openPositionsCount,
    };
  }

  async markSignalExpired(
    signalId: string,
    gracePeriodMinutes?: number,
  ): Promise<Signal> {
    const signal = await this.signalRepository.findOneOrFail({
      where: { id: signalId },
    });

    const now = new Date();
    signal.status = SignalStatus.EXPIRED;
    signal.outcome = SignalOutcome.EXPIRED;

    if (gracePeriodMinutes && gracePeriodMinutes > 0) {
      signal.gracePeriodEndsAt = new Date(
        now.getTime() + gracePeriodMinutes * 60 * 1000,
      );
    } else {
      signal.closedAt = now;
    }

    await this.signalRepository.save(signal);
    this.logger.log(
      `Signal ${signalId} marked as expired. Grace period: ${gracePeriodMinutes ?? 0} minutes`,
    );

    return signal;
  }

  async markSignalClosed(
    signalId: string,
    outcome: SignalOutcome,
  ): Promise<Signal> {
    const signal = await this.signalRepository.findOneOrFail({
      where: { id: signalId },
    });

    signal.status = SignalStatus.CLOSED;
    signal.outcome = outcome;
    signal.closedAt = new Date();

    await this.signalRepository.save(signal);
    this.logger.log(`Signal ${signalId} closed with outcome: ${outcome}`);

    return signal;
  }

  async cancelSignal(signalId: string): Promise<Signal> {
    const signal = await this.signalRepository.findOneOrFail({
      where: { id: signalId },
    });

    signal.status = SignalStatus.CANCELLED;
    signal.outcome = SignalOutcome.CANCELLED;
    signal.closedAt = new Date();

    await this.signalRepository.save(signal);
    this.logger.log(`Signal ${signalId} cancelled by provider`);

    return signal;
  }

  async getOpenPositionsForSignal(signalId: string): Promise<CopiedPosition[]> {
    return this.positionRepository.find({
      where: {
        signalId,
        status: PositionStatus.OPEN,
      },
    });
  }

  async getOpenPositionsByUserIds(userIds: string[]): Promise<CopiedPosition[]> {
    if (userIds.length === 0) return [];

    return this.positionRepository.find({
      where: {
        userId: In(userIds),
        status: PositionStatus.OPEN,
      },
      relations: ['signal'],
    });
  }

  async getExpirationSummary(): Promise<ExpiredSignalsSummary> {
    const expiredSignals = await this.findExpiredSignals();
    const gracePeriodSignals = await this.findSignalsInGracePeriod();

    const checkResults = await Promise.all(
      [...expiredSignals, ...gracePeriodSignals].map((signal) =>
        this.checkSignalExpiration(signal.id),
      ),
    );

    return {
      checkedAt: new Date(),
      totalExpired: expiredSignals.length,
      totalInGracePeriod: gracePeriodSignals.length,
      signals: checkResults,
    };
  }
}
