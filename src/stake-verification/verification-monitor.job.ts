import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StakeVerificationService } from './stake-verification.service';

// import { Provider } from '../entities/provider.entity';

@Injectable()
export class VerificationMonitorJob {
  private readonly logger = new Logger(VerificationMonitorJob.name);
  private isRunning = false;

  constructor(
    private readonly stakeVerificationService: StakeVerificationService,
    // @InjectRepository(Provider)
    // private readonly providerRepository: Repository<Provider>,
  ) {}

  /**
   * Daily monitoring job to verify all verified providers' stakes
   * Runs at 2:00 AM every day
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'stake-verification-monitor',
    timeZone: 'UTC',
  })
  async monitorVerifiedProviders(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Monitoring job already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    this.logger.log('Starting daily stake verification monitoring job');

    try {
      // Get all verified providers
      const verifiedProviders = await this.getVerifiedProviders();
      this.logger.log(`Found ${verifiedProviders.length} verified providers to check`);

      if (verifiedProviders.length === 0) {
        this.logger.log('No verified providers to monitor');
        return;
      }

      // Bulk verify all providers
      const results = await this.stakeVerificationService.bulkVerifyProviders(verifiedProviders);

      // Analyze results
      let maintained = 0;
      let revoked = 0;

      results.forEach((isVerified, publicKey) => {
        if (isVerified) {
          maintained++;
        } else {
          revoked++;
          this.logger.warn(`Verification revoked for ${publicKey} due to insufficient stake`);
        }
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(
        `Monitoring job completed in ${duration}s. Results: ${maintained} maintained, ${revoked} revoked`,
      );

      // Send notification if any verifications were revoked
      if (revoked > 0) {
        await this.notifyRevokedVerifications(revoked);
      }
    } catch (error) {
      this.logger.error('Monitoring job failed:', error.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Hourly health check to ensure monitoring system is working
   * Runs every hour at minute 30
   */
  @Cron('30 * * * *', {
    name: 'stake-monitoring-health-check',
    timeZone: 'UTC',
  })
  async healthCheck(): Promise<void> {
    this.logger.debug('Stake monitoring system health check');
    
    try {
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
      this.logger.error('Health check failed:', error.message);
    }
  }

  /**
   * Manual trigger for immediate verification check
   */
  async triggerImmediateCheck(): Promise<void> {
    this.logger.log('Manual stake verification check triggered');
    await this.monitorVerifiedProviders();
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
      this.logger.error(`Failed to check provider ${publicKey}:`, error.stack);
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
   * Send notifications when verifications are revoked
   */
  private async notifyRevokedVerifications(count: number): Promise<void> {
    this.logger.warn(`${count} provider verification(s) were revoked due to insufficient stake`);
    
    // TODO: Implement actual notification system
    // Examples:
    // - Send email to admins
    // - Post to Slack channel
    // - Trigger webhook
    // - Store in notifications table
    
    // For now, just log
    this.logger.log('Revocation notifications would be sent here');
  }

  /**
   * Get monitoring job statistics
   */
  async getMonitoringStats(): Promise<{
    isRunning: boolean;
    totalVerifiedProviders: number;
    lastRunTime?: Date;
  }> {
    const providers = await this.getVerifiedProviders();
    
    return {
      isRunning: this.isRunning,
      totalVerifiedProviders: providers.length,
      // In production, you'd store and retrieve the last run time from database
      lastRunTime: undefined,
    };
  }
}