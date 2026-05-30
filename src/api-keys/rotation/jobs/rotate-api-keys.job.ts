import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiKeyRotationService } from '../api-key-rotation.service';

@Injectable()
export class RotateApiKeysJob {
  private readonly logger = new Logger(RotateApiKeysJob.name);

  constructor(private readonly rotationService: ApiKeyRotationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRotation(): Promise<void> {
    this.logger.log('Running scheduled API key rotation check');
    try {
      const count = await this.rotationService.rotateExpiredKeys();
      this.logger.log(`Rotated ${count} expired API keys`);
    } catch (err) {
      this.logger.error('API key rotation job failed', err);
    }
  }
}
