import { Injectable, Logger } from '@nestjs/common';

export interface PushTokenEntry {
  userId: string;
  token: string;
  platform: 'ios' | 'android';
  registeredAt: Date;
}

@Injectable()
export class PushTokenManagerService {
  private readonly logger = new Logger(PushTokenManagerService.name);
  // In-memory store; replace with DB/Redis in production
  private readonly tokens = new Map<string, PushTokenEntry>();

  register(userId: string, token: string, platform: 'ios' | 'android'): void {
    this.tokens.set(token, { userId, token, platform, registeredAt: new Date() });
    this.logger.log(`Registered push token for user ${userId} [${platform}]`);
  }

  deregister(token: string): void {
    this.tokens.delete(token);
  }

  getTokensForUser(userId: string): PushTokenEntry[] {
    return [...this.tokens.values()].filter((t) => t.userId === userId);
  }
}
