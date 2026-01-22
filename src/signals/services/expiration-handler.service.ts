import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  CopiedPosition,
  PositionStatus,
  AutoCloseReason,
} from '../entities/copied-position.entity';
import {
  UserExpirationPreference,
  ExpirationAction,
} from '../entities/user-expiration-preference.entity';
import { Signal, SignalOutcome } from '../entities/signal.entity';
import { SignalExpirationService } from './signal-expiration.service';
import { ExpirationNotificationService } from './expiration-notification.service';

export interface PositionCloseResult {
  positionId: string;
  userId: string;
  success: boolean;
  reason: AutoCloseReason;
  error?: string;
}

export interface ExpirationHandlerResult {
  signalId: string;
  processedAt: Date;
  positionsProcessed: number;
  positionsClosed: number;
  positionsNotified: number;
  errors: string[];
  results: PositionCloseResult[];
}

export const EXPIRATION_QUEUE = 'signal-expiration';

@Injectable()
export class ExpirationHandlerService {
  private readonly logger = new Logger(ExpirationHandlerService.name);

  constructor(
    @InjectRepository(CopiedPosition)
    private positionRepository: Repository<CopiedPosition>,
    @InjectRepository(UserExpirationPreference)
    private preferenceRepository: Repository<UserExpirationPreference>,
    @InjectQueue(EXPIRATION_QUEUE)
    private expirationQueue: Queue,
    private signalExpirationService: SignalExpirationService,
    private notificationService: ExpirationNotificationService,
  ) {}

  async handleSignalExpiration(signal: Signal): Promise<ExpirationHandlerResult> {
    this.logger.log(`Handling expiration for signal ${signal.id}`);

    const openPositions = await this.signalExpirationService.getOpenPositionsForSignal(
      signal.id,
    );

    const results: PositionCloseResult[] = [];
    const errors: string[] = [];
    let positionsClosed = 0;
    let positionsNotified = 0;

    for (const position of openPositions) {
      try {
        const preference = await this.getUserPreference(position.userId);
        const result = await this.processPositionExpiration(
          position,
          signal,
          preference,
        );

        results.push(result);

        if (result.success && result.reason !== AutoCloseReason.USER_MANUAL) {
          positionsClosed++;
        }
        positionsNotified++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Position ${position.id}: ${errorMessage}`);
        results.push({
          positionId: position.id,
          userId: position.userId,
          success: false,
          reason: AutoCloseReason.SIGNAL_EXPIRED,
          error: errorMessage,
        });
      }
    }

    return {
      signalId: signal.id,
      processedAt: new Date(),
      positionsProcessed: openPositions.length,
      positionsClosed,
      positionsNotified,
      errors,
      results,
    };
  }

  async handleSignalCancellation(signal: Signal): Promise<ExpirationHandlerResult> {
    this.logger.log(`Handling cancellation for signal ${signal.id}`);

    const openPositions = await this.signalExpirationService.getOpenPositionsForSignal(
      signal.id,
    );

    const results: PositionCloseResult[] = [];
    const errors: string[] = [];
    let positionsClosed = 0;

    for (const position of openPositions) {
      try {
        await this.closePosition(position, AutoCloseReason.SIGNAL_CANCELLED);
        await this.notificationService.notifySignalCancelled(
          position.userId,
          signal,
          position,
        );

        results.push({
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason: AutoCloseReason.SIGNAL_CANCELLED,
        });
        positionsClosed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Position ${position.id}: ${errorMessage}`);
        results.push({
          positionId: position.id,
          userId: position.userId,
          success: false,
          reason: AutoCloseReason.SIGNAL_CANCELLED,
          error: errorMessage,
        });
      }
    }

    return {
      signalId: signal.id,
      processedAt: new Date(),
      positionsProcessed: openPositions.length,
      positionsClosed,
      positionsNotified: positionsClosed,
      errors,
      results,
    };
  }

  async handleGracePeriodEnd(signal: Signal): Promise<ExpirationHandlerResult> {
    this.logger.log(`Handling grace period end for signal ${signal.id}`);

    const openPositions = await this.signalExpirationService.getOpenPositionsForSignal(
      signal.id,
    );

    const results: PositionCloseResult[] = [];
    const errors: string[] = [];
    let positionsClosed = 0;

    for (const position of openPositions) {
      try {
        await this.closePosition(position, AutoCloseReason.GRACE_PERIOD_ENDED);
        await this.notificationService.notifyPositionAutoClosed(
          position.userId,
          signal,
          position,
          AutoCloseReason.GRACE_PERIOD_ENDED,
        );

        results.push({
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason: AutoCloseReason.GRACE_PERIOD_ENDED,
        });
        positionsClosed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Position ${position.id}: ${errorMessage}`);
        results.push({
          positionId: position.id,
          userId: position.userId,
          success: false,
          reason: AutoCloseReason.GRACE_PERIOD_ENDED,
          error: errorMessage,
        });
      }
    }

    await this.signalExpirationService.markSignalClosed(
      signal.id,
      SignalOutcome.EXPIRED,
    );

    return {
      signalId: signal.id,
      processedAt: new Date(),
      positionsProcessed: openPositions.length,
      positionsClosed,
      positionsNotified: positionsClosed,
      errors,
      results,
    };
  }

  private async processPositionExpiration(
    position: CopiedPosition,
    signal: Signal,
    preference: UserExpirationPreference,
  ): Promise<PositionCloseResult> {
    const reason = AutoCloseReason.SIGNAL_EXPIRED;

    switch (preference.defaultAction) {
      case ExpirationAction.AUTO_CLOSE:
        await this.closePosition(position, reason);
        await this.notificationService.notifyPositionAutoClosed(
          position.userId,
          signal,
          position,
          reason,
        );
        return {
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason,
        };

      case ExpirationAction.NOTIFY_ONLY:
        await this.notificationService.notifySignalExpired(
          position.userId,
          signal,
          position,
        );
        return {
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason: AutoCloseReason.USER_MANUAL,
        };

      case ExpirationAction.EXTEND_GRACE_PERIOD:
        await this.notificationService.notifyGracePeriodStarted(
          position.userId,
          signal,
          position,
          preference.gracePeriodMinutes,
        );
        return {
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason: AutoCloseReason.USER_MANUAL,
        };

      case ExpirationAction.DO_NOTHING:
      default:
        return {
          positionId: position.id,
          userId: position.userId,
          success: true,
          reason: AutoCloseReason.USER_MANUAL,
        };
    }
  }

  private async closePosition(
    position: CopiedPosition,
    reason: AutoCloseReason,
  ): Promise<CopiedPosition> {
    position.status = PositionStatus.AUTO_CLOSED;
    position.autoCloseReason = reason;
    position.closedAt = new Date();

    return this.positionRepository.save(position);
  }

  private async getUserPreference(userId: string): Promise<UserExpirationPreference> {
    let preference = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (!preference) {
      preference = this.preferenceRepository.create({
        userId,
        defaultAction: ExpirationAction.NOTIFY_ONLY,
        gracePeriodMinutes: 30,
        notifyBeforeExpirationMinutes: 60,
        notifyOnAutoClose: true,
        notifyOnGracePeriodStart: true,
      });
      await this.preferenceRepository.save(preference);
    }

    return preference;
  }

  async queueExpirationCheck(signalId: string): Promise<void> {
    await this.expirationQueue.add('check-signal-expiration', { signalId });
  }

  async queueBatchExpirationCheck(): Promise<void> {
    await this.expirationQueue.add('check-all-expirations', {});
  }

  async queueGracePeriodCheck(): Promise<void> {
    await this.expirationQueue.add('check-grace-periods', {});
  }

  async queueExpirationWarnings(minutesBefore: number): Promise<void> {
    await this.expirationQueue.add('send-expiration-warnings', { minutesBefore });
  }
}
