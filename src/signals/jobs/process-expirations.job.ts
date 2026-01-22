import {
  Processor,
  Process,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SignalExpirationService } from '../services/signal-expiration.service';
import { ExpirationHandlerService, EXPIRATION_QUEUE } from '../services/expiration-handler.service';
import { ExpirationNotificationService } from '../services/expiration-notification.service';
import { PositionStatus } from '../entities/copied-position.entity';

interface CheckSignalExpirationData {
  signalId: string;
}

interface SendExpirationWarningsData {
  minutesBefore: number;
}

interface ProcessExpirationsResult {
  processedCount: number;
  closedCount: number;
  errorCount: number;
  errors: string[];
}

interface GracePeriodResult {
  processedCount: number;
  closedCount: number;
  errors: string[];
}

interface WarningsResult {
  signalsChecked: number;
  notificationsSent: number;
  errors: string[];
}

@Processor(EXPIRATION_QUEUE)
export class ProcessExpirationsJob {
  private readonly logger = new Logger(ProcessExpirationsJob.name);

  constructor(
    private signalExpirationService: SignalExpirationService,
    private expirationHandlerService: ExpirationHandlerService,
    private notificationService: ExpirationNotificationService,
  ) {}

  @Process('check-signal-expiration')
  async handleCheckSignalExpiration(
    job: Job<CheckSignalExpirationData>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const { signalId } = job.data;

    try {
      const checkResult = await this.signalExpirationService.checkSignalExpiration(signalId);

      if (checkResult.isExpired && !checkResult.isInGracePeriod) {
        const signal = await this.signalExpirationService.markSignalExpired(signalId, 30);
        const handlerResult = await this.expirationHandlerService.handleSignalExpiration(signal);

        return { success: true, result: handlerResult };
      }

      return { success: true, result: checkResult };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to check signal expiration: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  @Process('check-all-expirations')
  async handleCheckAllExpirations(): Promise<ProcessExpirationsResult> {
    this.logger.log('Starting batch expiration check');

    const expiredSignals = await this.signalExpirationService.findExpiredSignals();
    const results: ProcessExpirationsResult = {
      processedCount: 0,
      closedCount: 0,
      errorCount: 0,
      errors: [],
    };

    for (const signal of expiredSignals) {
      try {
        await this.signalExpirationService.markSignalExpired(signal.id, 30);
        const handlerResult = await this.expirationHandlerService.handleSignalExpiration(signal);

        results.processedCount++;
        results.closedCount += handlerResult.positionsClosed;

        if (handlerResult.errors.length > 0) {
          results.errors.push(...handlerResult.errors);
          results.errorCount += handlerResult.errors.length;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Signal ${signal.id}: ${errorMessage}`);
        results.errorCount++;
      }
    }

    this.logger.log(
      `Batch expiration check completed: ${results.processedCount} processed, ${results.closedCount} closed, ${results.errorCount} errors`,
    );

    return results;
  }

  @Process('check-grace-periods')
  async handleCheckGracePeriods(): Promise<GracePeriodResult> {
    this.logger.log('Starting grace period check');

    const gracePeriodSignals = await this.signalExpirationService.findSignalsInGracePeriod();
    const results: GracePeriodResult = {
      processedCount: 0,
      closedCount: 0,
      errors: [],
    };

    for (const signal of gracePeriodSignals) {
      try {
        const handlerResult = await this.expirationHandlerService.handleGracePeriodEnd(signal);
        results.processedCount++;
        results.closedCount += handlerResult.positionsClosed;

        if (handlerResult.errors.length > 0) {
          results.errors.push(...handlerResult.errors);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Signal ${signal.id}: ${errorMessage}`);
      }
    }

    this.logger.log(
      `Grace period check completed: ${results.processedCount} processed, ${results.closedCount} closed`,
    );

    return results;
  }

  @Process('send-expiration-warnings')
  async handleSendExpirationWarnings(
    job: Job<SendExpirationWarningsData>,
  ): Promise<WarningsResult> {
    const { minutesBefore } = job.data;
    this.logger.log(`Sending expiration warnings for signals expiring in ${minutesBefore} minutes`);

    const signals = await this.signalExpirationService.findSignalsApproachingExpiration(minutesBefore);
    const results: WarningsResult = {
      signalsChecked: signals.length,
      notificationsSent: 0,
      errors: [],
    };

    for (const signal of signals) {
      const openPositions = signal.copiedPositions?.filter(
        (p) => p.status === PositionStatus.OPEN,
      ) ?? [];

      for (const position of openPositions) {
        try {
          await this.notificationService.notifyExpirationWarning(
            position.userId,
            signal,
            position,
            minutesBefore,
          );
          results.notificationsSent++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push(`Position ${position.id}: ${errorMessage}`);
        }
      }
    }

    this.logger.log(
      `Expiration warnings sent: ${results.notificationsSent} notifications for ${results.signalsChecked} signals`,
    );

    return results;
  }

  @Process('handle-signal-cancellation')
  async handleSignalCancellation(
    job: Job<CheckSignalExpirationData>,
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const { signalId } = job.data;

    try {
      const signal = await this.signalExpirationService.cancelSignal(signalId);
      const handlerResult = await this.expirationHandlerService.handleSignalCancellation(signal);

      return { success: true, result: handlerResult };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to handle signal cancellation: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  @OnQueueActive()
  onActive(job: Job): void {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: unknown): void {
    this.logger.debug(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
