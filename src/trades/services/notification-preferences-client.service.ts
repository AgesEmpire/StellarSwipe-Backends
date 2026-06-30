import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { of } from 'rxjs';
import {
  TCP_PATTERNS,
  GetUserPreferencesRequest,
  UserPreferencesResponse,
} from '../../notifications/dto/tcp-notification.dto';

export const NOTIFICATION_TCP_CLIENT = 'NOTIFICATION_TCP_CLIENT';

@Injectable()
export class NotificationPreferencesClientService implements OnModuleInit {
  private readonly logger = new Logger(NotificationPreferencesClientService.name);

  constructor(
    @Inject(NOTIFICATION_TCP_CLIENT) private readonly client: ClientProxy,
  ) {}

  async onModuleInit() {
    await this.client.connect().catch((err) => {
      this.logger.warn(`TCP connection to notification service failed: ${err?.message ?? err}`);
    });
  }

  async getUserPreferences(userId: string): Promise<UserPreferencesResponse | null> {
    const payload: GetUserPreferencesRequest = { userId };

    const result = await firstValueFrom(
      this.client.send<UserPreferencesResponse>(TCP_PATTERNS.GET_USER_PREFERENCES, payload).pipe(
        timeout(5000),
        catchError((err) => {
          this.logger.error(
            `TCP call get_user_notification_preferences timed out or failed for user ${userId}: ${err?.message ?? err}`,
          );
          return of(null);
        }),
      ),
    );

    return result;
  }
}
