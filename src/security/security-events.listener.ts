import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';

export interface SecurityEvent {
  type: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SecurityEventsListener {
  private readonly logger = new Logger(SecurityEventsListener.name);

  constructor(private readonly userService: UserService) {}

  @OnEvent('security.event', { async: true })
  async handleSecurityEvent(event: SecurityEvent): Promise<void> {
    const user = await this.resolveUser(event.userId);

    if (!user) {
      // Do not log the userId or any account-identifying detail to avoid
      // leaking account existence through logs.
      this.logger.warn(`Security event "${event.type}" received for an unknown user`);
      return;
    }

    this.logger.log(`Security event "${event.type}" processed for user ${user.id}`);
  }

  /**
   * Resolves a user through the injected user service.
   * Returns null deterministically when the user is missing or deleted,
   * and never throws on lookup failure so callers can handle it uniformly.
   */
  private async resolveUser(userId: string): Promise<User | null> {
    if (!userId) {
      return null;
    }

    try {
      const user = await this.userService.findById(userId);
      return user ?? null;
    } catch (error) {
      // Swallow lookup failures to avoid leaking account existence and to
      // keep event handling deterministic.
      this.logger.error(`Failed to resolve user for security event: ${(error as Error).message}`);
      return null;
    }
  }
}
