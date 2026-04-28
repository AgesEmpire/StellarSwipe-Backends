import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

export interface SessionData {
  userId: string;
  publicKey: string;
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessionTTL: number;
  private readonly maxSessionsPerUser: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private configService: ConfigService,
  ) {
    this.sessionTTL = this.configService.get('auth.sessionTTL', 86400); // 24 hours
    this.maxSessionsPerUser = this.configService.get(
      'auth.maxSessionsPerUser',
      5,
    );
  }

  async createSession(
    sessionId: string,
    userId: string,
    publicKey: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const now = Date.now();
    const sessionData: SessionData = {
      userId,
      publicKey,
      createdAt: now,
      lastActivity: now,
      metadata,
    };

    // Store session data
    await this.cacheManager.set(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      this.sessionTTL * 1000,
    );

    // Track user sessions
    await this.addUserSession(userId, sessionId);

    this.logger.log(`Session created for user ${userId}: ${sessionId}`);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const data = await this.cacheManager.get<string>(`session:${sessionId}`);
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      this.logger.error(`Failed to parse session data: ${error.message}`);
      return null;
    }
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = Date.now();
    await this.cacheManager.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      this.sessionTTL * 1000,
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.removeUserSession(session.userId, sessionId);
    }

    await this.cacheManager.del(`session:${sessionId}`);
    this.logger.log(`Session deleted: ${sessionId}`);
  }

  async getUserSessions(userId: string): Promise<string[]> {
    const data = await this.cacheManager.get<string>(`user_sessions:${userId}`);
    if (!data) {
      return [];
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      this.logger.error(`Failed to parse user sessions: ${error.message}`);
      return [];
    }
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.getUserSessions(userId);

    // Delete all sessions in parallel
    await Promise.all(
      sessions.map((sessionId) =>
        this.cacheManager.del(`session:${sessionId}`),
      ),
    );

    await this.cacheManager.del(`user_sessions:${userId}`);
    this.logger.log(`All sessions deleted for user ${userId}`);
  }

  private async addUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = await this.getUserSessions(userId);

    // Enforce max sessions per user
    if (sessions.length >= this.maxSessionsPerUser) {
      const oldestSession = sessions.shift();
      if (oldestSession) {
        await this.cacheManager.del(`session:${oldestSession}`);
        this.logger.log(
          `Removed oldest session for user ${userId}: ${oldestSession}`,
        );
      }
    }

    sessions.push(sessionId);
    await this.cacheManager.set(
      `user_sessions:${userId}`,
      JSON.stringify(sessions),
      this.sessionTTL * 1000,
    );
  }

  private async removeUserSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = await this.getUserSessions(userId);
    const filtered = sessions.filter((id) => id !== sessionId);

    if (filtered.length > 0) {
      await this.cacheManager.set(
        `user_sessions:${userId}`,
        JSON.stringify(filtered),
        this.sessionTTL * 1000,
      );
    } else {
      await this.cacheManager.del(`user_sessions:${userId}`);
    }
  }

  async getActiveSessionCount(): Promise<number> {
    // This is an approximation - in production, use Redis SCAN
    // For now, return 0 as placeholder
    return 0;
  }
}
