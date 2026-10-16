import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StakeVerificationService } from './stake-verification.service';
import {
  buildVerificationAlertKey,
  VerificationAlertType,
} from './stake-verification-alert.dto';
import { StakeVerificationAlertService } from './stake-verification-alert.service';

// import { Provider } from '../entities/provider.entity';

const MONITOR_JOB_NAME = 'monitorVerifiedProviders';
/** How old the last successful run may be before it is alerted on. */
const DEFAULT_MAX_STALENESS_MS = 26 * 60 * 60 * 1000;

export interface VerificationMonitoringRunResult {
  status: 'completed' | 'failed' | 'skipped';
  checked: number;
  maintained: number;
  revoked: number;
  failed: number;
  durationMs: number;
  error?: string;
}

@Injectable()
export class VerificationMonitorJob {
  private readonly logger = new Logger(VerificationMonitorJob.name);
  private isRunning = false;
  private lastRunAt?: Date;
  private lastSuccessfulRunAt?: Date;

  constructor(
    private readonly stakeVerificationService: StakeVerificationService,
    @Optional()
    private readonly alertService?: StakeVerificationAlertService,
    @Optional()
    private readonly configService?: ConfigService,
    // @InjectRepository(Provider)
    // private readonly providerRepository: Repository<Provider>,
  ) {}

  /**
   * Daily monitoring job to verify all verified providers' stakes
   * Runs at 2:00 AM every day
   * Note: Schedule decoration removed - use triggerImmediateCheck() to manually trigger
   */
  async monitorVerifiedProviders(): Promise<VerificationMonitoringRunResult> {
    const startedAt = Date.now();

    if (this.isRunning) {
      this.logger.warn('Monitoring job already running, skipping this execution');
      return {
        status: 'skipped',
        checked: 0,
        maintained: 0,
        revoked: 0,
        failed: 0,
        durationMs: 0,
      };
    }

    this.isRunning = true;
    this.lastRunAt = new Date();
    this.logger.log('Starting daily stake verification monitoring job');

    let checked = 0;
    let maintained = 0;
    let revoked = 0;
    let failed = 0;

    try {
      // Get all verified providers
      const verifiedProviders = await this.getVerifiedProviders();
      checked = verifiedProviders.length;
      this.logger.log(`Found ${checked} verified providers to check`);

      const revokedPublicKeys: string[] = [];

      // Each validator is checked independently so a failure can be attributed
      // to a specific validator instead of aborting (or silently skewing) the
      // whole run.
      for (const publicKey of verifiedProviders) {
        try {
          const results =
            await this.stakeVerificationService.bulkVerifyProviders([publicKey]);

          if (results.get(publicKey) === true) {
            maintained++;
            await this.resolveAlert(VerificationAlertType.CHECK_FAILED, publicKey);
            await this.resolveAlert(
              VerificationAlertType.VERIFICATION_REVOKED,
              publicKey,
            );
          } else {
            revoked++;
            revokedPublicKeys.push(publicKey);
            this.logger.warn(
              `Verification revoked for ${publicKey} due to insufficient stake`,
            );
          }
        } catch (error) {
          failed++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(`Stake check failed for ${publicKey}: ${errorMessage}`);
          await this.alertService?.raise({
            type: VerificationAlertType.CHECK_FAILED,
            validatorPublicKey: publicKey,
            jobName: MONITOR_JOB_NAME,
            message: `Stake verification check failed for ${publicKey}: ${errorMessage}`,
            context: { error: errorMessage, checkedAt: new Date().toISOString() },
          });
        }
      }

      const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
      this.logger.log(
        `Monitoring job completed in ${duration}s. Results: ${maintained} maintained, ` +
          `${revoked} revoked, ${failed} failed`,
      );

      if (revokedPublicKeys.length > 0) {
        await this.notifyRevokedVerifications(revokedPublicKeys);
      }

      // The run succeeded: the monitor is healthy again.
      this.lastSuccessfulRunAt = new Date();
      await this.resolveAlert(VerificationAlertType.CHECK_MISSED);
      await this.resolveAlert(VerificationAlertType.CHECK_DELAYED, undefined, {
        reason: 'monitoring run completed successfully',
      });

      return {
        status: 'completed',
        checked,
        maintained,
        revoked,
        failed,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error('Monitoring job failed:', errorMessage);

      // A run that never completed must not disappear into a log line.
      await this.alertService?.raise({
        type: VerificationAlertType.CHECK_MISSED,
        jobName: MONITOR_JOB_NAME,
        message: `Stake verification monitoring run failed: ${errorMessage}`,
        context: { error: errorMessage, startedAt: new Date(startedAt).toISOString() },
      });

      return {
        status: 'failed',
        checked,
        maintained,
        revoked,
        failed,
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Hourly health check to ensure monitoring system is working
   * Runs every hour at minute 30
   */
  async healthCheck(): Promise<void> {
    this.logger.debug('Stake monitoring system health check');

    try {
      const maxStalenessMs = this.getMaxStalenessMs();
      const stalenessMs = this.getStalenessMs(Date.now());

      if (stalenessMs > maxStalenessMs) {
        await this.alertService?.raise({
          type: VerificationAlertType.CHECK_DELAYED,
          jobName: MONITOR_JOB_NAME,
          message:
            'Stake verification monitor has not completed a successful run within ' +
            `${Math.round(maxStalenessMs / 60_000)} minute(s)`,
          context: {
            lastSuccessfulRunAt:
              this.lastSuccessfulRunAt?.toISOString() ?? null,
            stalenessMs: Number.isFinite(stalenessMs) ? stalenessMs : null,
            maxStalenessMs,
          },
        });
      } else {
        await this.resolveAlert(VerificationAlertType.CHECK_DELAYED, undefined, {
          reason: 'health check passed',
        });
      }

      // Perform a simple check - verify one random provider if any exist
      const providers = await this.getVerifiedProviders();

      if (providers.length > 0) {
        const randomProvider = providers[Math.floor(Math.random() * providers.length)];
        const status = await this.stakeVerificationService.getVerificationStatus(randomProvider);
        this.logger.debug(`Health check passed. Sample provider ${randomProvider}: ${status.isVerified}`);
      } else {
        this.logger.debug('Health check passed. No providers to verify.');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Health check failed:', errorMessage);
    }
  }

  /**
   * Manual trigger for immediate verification check
   */
  async triggerImmediateCheck(): Promise<VerificationMonitoringRunResult> {
    this.logger.log('Manual stake verification check triggered');
    return this.monitorVerifiedProviders();
  }

  /**
   * Check a specific provider's stake status
   */
  async checkSpecificProvider(publicKey: string): Promise<void> {
    this.logger.log(`Checking stake for specific provider: ${publicKey}`);

    try {
      const results = await this.stakeVerificationService.bulkVerifyProviders([publicKey]);
      const isVerified = results.get(publicKey);

      this.logger.log(`Provider ${publicKey} verification status: ${isVerified ? 'VERIFIED' : 'NOT VERIFIED'}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to check provider ${publicKey}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Get all verified providers from database
   */
  private async getVerifiedProviders(): Promise<string[]> {
    // Uncomment when Provider entity is available
    /*
    const providers = await this.providerRepository.find({
      where: { verified: true },
      select: ['publicKey'],
    });

    return providers.map(p => p.publicKey);
    */

    // Mock data for testing
    this.logger.warn('Using mock provider data. Implement Provider entity for production.');
    return [
      // Add your test provider public keys here
      // 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    ];
  }

  /**
   * Alert on the validators whose verification was revoked, one alert per
   * provider, and record the context operators need to act.
   */
  private async notifyRevokedVerifications(
    revokedPublicKeys: string[],
  ): Promise<void> {
    this.logger.warn(
      `${revokedPublicKeys.length} provider verification(s) were revoked due to insufficient stake`,
    );

    for (const publicKey of revokedPublicKeys) {
      await this.alertService?.raise({
        type: VerificationAlertType.VERIFICATION_REVOKED,
        validatorPublicKey: publicKey,
        jobName: MONITOR_JOB_NAME,
        message: `Verification revoked for ${publicKey}: stake is below the required minimum`,
        context: { revokedAt: new Date().toISOString() },
      });
    }
  }

  /**
   * Resolve an alert for a validator (or job-wide when no key is given) after a
   * successful check. Never let alert bookkeeping break the monitoring run.
   */
  private async resolveAlert(
    type: VerificationAlertType,
    validatorPublicKey?: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.alertService) {
      return;
    }

    try {
      await this.alertService.resolve(
        buildVerificationAlertKey(type, validatorPublicKey),
        { resolvedBy: MONITOR_JOB_NAME, resolvedAt: new Date().toISOString(), ...context },
      );
    } catch (error) {
      this.logger.error(
        `Failed to resolve stake verification alert ${buildVerificationAlertKey(
          type,
          validatorPublicKey,
        )}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getMaxStalenessMs(): number {
    const configured = Number(
      this.configService?.get<string | number>(
        'STAKE_MONITOR_MAX_STALENESS_MS',
        DEFAULT_MAX_STALENESS_MS,
      ),
    );

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_STALENESS_MS;
  }

  private getStalenessMs(now: number): number {
    if (!this.lastSuccessfulRunAt) {
      return Number.POSITIVE_INFINITY;
    }

    return now - this.lastSuccessfulRunAt.getTime();
  }

  /**
   * Get monitoring job statistics
   */
  async getMonitoringStats(): Promise<{
    isRunning: boolean;
    totalVerifiedProviders: number;
    lastRunTime?: Date;
    lastSuccessfulRunTime?: Date;
  }> {
    const providers = await this.getVerifiedProviders();

    return {
      isRunning: this.isRunning,
      totalVerifiedProviders: providers.length,
      lastRunTime: this.lastRunAt,
      lastSuccessfulRunTime: this.lastSuccessfulRunAt,
    };
  }
}
