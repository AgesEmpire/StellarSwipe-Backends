import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  PreferencesService,
  PreferencesResponse,
  NotificationType,
  NotificationChannel,
} from './preferences.service';
import { UpdatePreferencesDto } from '../dto/update-preferences.dto';

// Replace with your actual auth guard and user decorator
// import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
// import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('notifications/preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  // GET /notifications/preferences
  // In production: use @UseGuards(JwtAuthGuard) and extract userId from @CurrentUser()
  // The userId param here is a stand-in until auth decorators are confirmed
  @Get()
  @HttpCode(HttpStatus.OK)
  async getPreferences(
    @Query('userId') userId: string,
  ): Promise<PreferencesResponse> {
    return this.preferencesService.getPreferences(userId);
  }

  // PUT /notifications/preferences
  @Put()
  @HttpCode(HttpStatus.OK)
  async updatePreferences(
    @Query('userId') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<PreferencesResponse> {
    return this.preferencesService.updatePreferences(userId, dto);
  }

  // GET /notifications/preferences/unsubscribe
  // Used by email unsubscribe links:
  // e.g. /notifications/preferences/unsubscribe?userId=X&type=marketing&channel=email
  @Get('unsubscribe')
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @Query('userId') userId: string,
    @Query('type') type: NotificationType,
    @Query('channel') channel: NotificationChannel,
  ): Promise<{ message: string }> {
    await this.preferencesService.unsubscribe(userId, type, channel);
    return {
      message: `Successfully unsubscribed from ${type} ${channel} notifications.`,
    };
  }
}
