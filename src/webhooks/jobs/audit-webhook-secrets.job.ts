import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Webhook } from '../entities/webhook.entity';
import { NotificationService } from '../../notifications/notification.service';
import { evaluateSecretStrength, hashSecret, MIN_ENTROPY_BITS_PER_CHAR, MIN_SECRET_LENGTH } from '../utils/secret-entropy.util';

@Injectable()
export class AuditWebhookSecretsJob {
  private readonly logger = new Logger(AuditWebhookSecretsJob.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async audit(): Promise<void> {
    this.logger.log('Starting webhook secret strength audit…');

    const webhooks = await this.webhookRepository.find();

    if (webhooks.length === 0) {
      this.logger.log('No webhooks found to audit.');
      return;
    }

    let strongCount = 0;
    let weakCount = 0;
    const weakWebhooks: { id: string; userId: string; masked: string }[] = [];

    for (const webhook of webhooks) {
      const result = evaluateSecretStrength(webhook.secret);

      if (result.isStrong) {
        strongCount++;
        this.logger.debug(
          `Webhook ${webhook.id} has a strong secret (length=${result.length}, entropy=${result.entropyBitsPerChar} bits/char)`,
        );
      } else {
        weakCount++;
        const masked = hashSecret(webhook.secret);
        weakWebhooks.push({ id: webhook.id, userId: webhook.userId, masked });
        this.logger.warn(
          `Webhook ${webhook.id} (user=${webhook.userId}) has a weak secret: ${result.reason}. Masked=${masked}`,
        );
      }
    }

    this.logger.log(
      `Secret audit complete — strong: ${strongCount}, weak: ${weakCount}, total: ${webhooks.length}`,
    );

    if (weakCount > 0) {
      await this.notifyOwners(weakWebhooks);
    }
  }

  private async notifyOwners(
    weakWebhooks: { id: string; userId: string; masked: string }[],
  ): Promise<void> {
    for (const entry of weakWebhooks) {
      try {
        await this.notificationService.send({
          userId: entry.userId,
          type: 'SYSTEM',
          title: 'Webhook Secret Rotation Required',
          message: `Your webhook (${entry.id}) is using a weak signing secret (masked=${entry.masked}). Please regenerate the secret to maintain signature verification security. Minimum length: ${MIN_SECRET_LENGTH} characters, minimum entropy: ${MIN_ENTROPY_BITS_PER_CHAR} bits/char.`,
          channel: 'in_app',
        });
      } catch (err) {
        this.logger.error(
          `Failed to send rotation notification for webhook ${entry.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
