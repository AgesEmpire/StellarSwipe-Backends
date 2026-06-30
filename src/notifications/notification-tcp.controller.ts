import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PreferencesService } from './preferences/preferences.service';
import {
  TCP_PATTERNS,
  GetUserPreferencesRequest,
  UserPreferencesResponse,
} from './dto/tcp-notification.dto';

@Controller()
export class NotificationTcpController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @MessagePattern(TCP_PATTERNS.GET_USER_PREFERENCES)
  async getUserPreferences(
    @Payload() data: GetUserPreferencesRequest,
  ): Promise<UserPreferencesResponse> {
    return this.preferencesService.getPreferences(data.userId);
  }
}
