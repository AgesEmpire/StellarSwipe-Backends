import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationStatus } from './entities/notification.entity';
import { NOTIFICATION_QUEUE } from './notification.service';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  @Process('deliver')
  async handleDeliver(job: Job<{ notificationId: string }>): Promise<void> {
    const { notificationId } = job.data;
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} not found for delivery`);
      return;
    }

    try {
      // Delivery logic: in production, integrate email/push providers here
      this.logger.log(`Delivering notification ${notificationId} via ${notification.channel} to user ${notification.userId}`);

      notification.status = NotificationStatus.SENT;
      await this.notificationRepository.save(notification);
    } catch (error) {
      this.logger.error(`Failed to deliver notification ${notificationId}`, error);
      notification.status = NotificationStatus.FAILED;
      await this.notificationRepository.save(notification);
      throw error; // triggers Bull retry
    }
  }
}
