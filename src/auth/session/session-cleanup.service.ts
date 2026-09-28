import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionManagerService } from './session-manager.service';

@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly sessionManager: SessionManagerService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredSessions(): Promise<void> {
    this.logger.log('Starting expired session cleanup');

    try {
      // Redis TTL handles most cleanup automatically
      // This is for additional cleanup logic if needed
      const activeCount = await this.sessionManager.getActiveSessionCount();
      this.logger.log(`Active sessions: ${activeCount}`);
    } catch (error) {
      this.logger.error(`Session cleanup failed: ${error.message}`);
    }
  }
}
