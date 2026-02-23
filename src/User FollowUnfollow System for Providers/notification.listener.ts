import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PROVIDER_FOLLOWED_EVENT,
  ProviderFollowedEvent,
} from '../providers/services/follower.service';

export const NEW_SIGNAL_EVENT = 'signal.created';

export interface NewSignalEvent {
  signalId: string;
  providerId: string;
  createdAt: Date;
}

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    @InjectRepository(require('../providers/entities/provider-follower.entity').ProviderFollower)
    private readonly followerRepository: Repository<any>,
  ) {}

  /**
   * Fires when a new signal is created.
   * Notifies all followers of that provider.
   */
  @OnEvent(NEW_SIGNAL_EVENT)
  async handleNewSignal(event: NewSignalEvent): Promise<void> {
    const followers = await this.followerRepository.find({
      where: { providerId: event.providerId },
      select: ['userId'],
    });

    if (!followers.length) return;

    const userIds = followers.map((f: any) => f.userId);

    this.logger.log(
      `New signal ${event.signalId} from provider ${event.providerId}. ` +
        `Notifying ${userIds.length} follower(s): ${userIds.join(', ')}`,
    );

    // TODO: Replace with your actual notification delivery (push, email, websocket, etc.)
    // Example: await this.notificationService.sendBulk(userIds, { signalId: event.signalId });
  }

  /**
   * Fires when a user follows a provider.
   */
  @OnEvent(PROVIDER_FOLLOWED_EVENT)
  async handleProviderFollowed(event: ProviderFollowedEvent): Promise<void> {
    this.logger.log(
      `User ${event.userId} followed provider ${event.providerId} at ${event.followedAt.toISOString()}`,
    );

    // TODO: Send welcome/confirmation notification to the user if desired.
  }
}
